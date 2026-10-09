/**
 * hai-client — the browser runtime.
 *
 * Headless: it owns the transport, the block store, and surface mounting.
 * It does NOT own how your transcript looks — see transcript.js for a default
 * renderer you are expected to replace.
 *
 * Note this package has no dependency on hai-server. The only thing crossing
 * that line is your surface contract, and on this side it crosses as types.
 */

/**
 * @param {{endpoint?: string, registry: Record<string, {mount: Function}>, notices?: Record<string, {mount: Function}>}} options
 */
export function createChat({ endpoint = "/hai", registry, notices = {} }) {
  const listeners = new Set();
  const state = {
    conversationId: null,
    model: "",
    status: "idle",
    blocks: [],
    /** handle -> { component, version, mode, props, state, instance, element } */
    surfaces: new Map(),
    context: { messages: [], modelTokens: 0, uiTokens: 0 },
    /**
     * When this conversation goes out of date, by this browser's clock: the
     * earliest freshness window among its surfaces, each counted from when the
     * request that rendered it was sent — so never later than the server's own
     * deadline. Null while nothing it shows can go stale.
     */
    expiresAt: null,
    /** The notice, once the conversation is out of date. Final until `reset()`. */
    expired: null,
    /** Notices the server has sent this conversation, in the order they were sent. */
    notices: [],
  };

  const notify = (event) => listeners.forEach((fn) => fn(state, event));

  /**
   * Requests open or waiting to go out — which is not the same as
   * `state.status`.
   *
   * The server emits `awaiting` and `idle` from inside the turn, then releases
   * its lease and saves after that frame has already reached us. Gating on
   * status lets the next request go out during that tail, and the server
   * answers 409. It matters because the composer is deliberately live while
   * awaiting — "pick an option above, or type to override" — so an override
   * there is the intended affordance, not a misuse.
   *
   * Requests are chained rather than refused: one never starts until the
   * previous response has closed, so this client cannot collide with itself.
   */
  let busy = 0;
  let chain = Promise.resolve();

  /**
   * Bumped by `reset()`. A request belongs to the conversation that was current
   * when it was made, and carries that conversation's abort signal: reset()
   * aborts it, so one still queued is refused by fetch before anything is sent,
   * and one already open stops. Waiting instead would queue the new
   * conversation's first request behind a stream that can stay open for a whole
   * model turn. Events already read are dropped too, so a stray `hello` cannot
   * pull this client back into the conversation it just left.
   */
  let generation = 0;
  let aborter = new AbortController();

  /** Set by close(): this chat is done for good, and does nothing more. */
  let shutDown = false;

  /** The events stream's conversation while it is open, and how to stop it. */
  let listening = null;
  let listenAborter = null;
  /**
   * Settles when the turn a wake notice started, streaming on the events
   * stream, is done. Until then nothing is posted: the server holds the
   * conversation for that turn, and a message sent now would only be told 409.
   */
  let remote = null;
  let endRemote = () => {};
  /**
   * Set when the events connection dropped while a wake turn ran. That turn
   * still holds the conversation on the server, and its `released` is lost
   * with the connection, so the next request is given longer to get in.
   */
  let cutOff = false;
  /** seq → the mounted notice's instance and element */
  const noticeMounts = new Map();

  /**
   * When the request now streaming was sent. The server stamps every surface
   * it renders after that request arrived, so a freshness deadline counted from
   * here is never later than the server's — however long the model takes, or
   * a buffering proxy holds the stream back.
   */
  let sentAt = 0;

  // ── transport: SSE over POST (EventSource cannot POST) ──────────────
  function enqueue(path, body) {
    const gen = generation;
    const { signal } = aborter;
    // set by pump once the server has answered this request itself
    const outcome = { sent: false };
    busy++;
    const run = chain
      .then(() => pump(path, body, gen, signal, outcome))
      .catch((err) => {
        // aborted by reset(): it belonged to a conversation the user has left
        if (gen === generation) throw err;
      })
      .finally(() => {
        busy--;
      });
    chain = run.catch(() => {});
    return run.then(() => outcome.sent);
  }

  const post = (path, body, signal) =>
    fetch(endpoint + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId: state.conversationId, ...body }),
      signal,
    });

  async function pump(path, body, gen, signal, outcome) {
    // A request left over from before reset() or close() does nothing at all:
    // not even closing an out-of-date conversation that is no longer this one.
    // The deadline is checked again here, not only when queued: a long turn
    // ahead of this request can run past it while it waits.
    if (gen !== generation || closed()) return;
    // queued behind a wake turn, as behind one of this client's own
    while (remote) {
      await remote;
      if (gen !== generation || closed()) return;
    }
    sentAt = Date.now();
    let res = await post(path, body, signal);

    // 409 means someone else holds this conversation's turn. Almost always that
    // is the previous request's own tail, milliseconds from finishing — but it
    // can also be a second tab, which no client-side guard can prevent. One
    // retry covers the first and gives up honestly on the second.
    if (res.status === 409) {
      await new Promise((r) => setTimeout(r, 150));
      // the deadline can pass during the wait, and reset() or close() come
      if (gen !== generation || closed()) return;
      // A wake turn may be what holds it, and have said so meanwhile: wait it
      // out, as if it had said so before this request went.
      while (remote) {
        await remote;
        if (gen !== generation || closed()) return;
      }
      res = await post(path, body, signal); // rejects at once if reset() aborted it meanwhile
    }
    // A wake turn this client lost sight of holds the conversation until it
    // ends, which may be a while: keep trying, backing off, for as long as a
    // turn can hold it before its lease lapses.
    if (res.status === 409 && cutOff) {
      const giveUp = Date.now() + CUT_OFF_MS;
      for (let wait = 250; res.status === 409 && Date.now() < giveUp; wait = Math.min(wait * 2, 2_000)) {
        await new Promise((r) => setTimeout(r, wait));
        if (gen !== generation || closed()) return;
        res = await post(path, body, signal);
      }
    }
    if (res.status !== 409) cutOff = false;
    // Anything but a second 409 means the server took the request up itself —
    // even an error — unless the stream says `expired` below. A 409 means it
    // turned the message away unread.
    outcome.sent = res.status !== 409;

    // A non-SSE response carries no `data:` frames, so parsing it as a stream
    // would fail silently and the UI would just sit there.
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      // an abort during that read is swallowed by the catch, so check here
      if (gen !== generation) return;
      apply({
        type: "error",
        message:
          detail.error ??
          (res.status === 409 ? "another turn is already in flight" : `request failed (${res.status})`),
      });
      return;
    }

    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let i;
      while ((i = buffer.indexOf("\n\n")) >= 0) {
        // Per frame, not per chunk: a subscriber may call reset() from inside
        // apply(), and the rest of this chunk belongs to the old conversation.
        // The abort stops later reads; it cannot recall what is already here.
        if (gen !== generation) return;
        const frame = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        const line = frame.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        const event = JSON.parse(line.slice(6));
        // refused inside a 200: the server recorded nothing, so it did not
        // take the message, whatever the status said
        if (event.type === "expired") outcome.sent = false;
        apply(event);
      }
    }
  }

  function apply(event) {
    switch (event.type) {
      case "hello":
        state.conversationId = event.conversationId;
        state.model = event.model;
        if (event.events) listen(event.conversationId);
        break;

      // From the events stream, in seq order. A reconnect resumes after the
      // last one seen, so anything not past it is one already shown, and is
      // dropped: one comparison, however long the backlog.
      case "notice": {
        if (event.seq <= (state.notices.at(-1)?.seq ?? 0)) return;
        const { type, ...notice } = event;
        state.notices.push(notice);
        const block = { kind: "notice", id: `n:${event.seq}`, ...notice };
        // beside its surface — after any notices already there — or at the end
        const at = event.handle === undefined ? -1 : state.blocks.findIndex((b) => b.kind === "ui" && b.handle === event.handle);
        if (at < 0) state.blocks.push(block);
        else {
          let i = at + 1;
          while (state.blocks[i]?.kind === "notice" && state.blocks[i].handle === event.handle) i++;
          state.blocks.splice(i, 0, block);
        }
        break;
      }

      // A stream that rejoins a wake turn is sent what the turn has shown so
      // far: a block this client already has is brought up to date, not added
      // again.
      case "block_start": {
        const known = state.blocks.find((b) => b.id === event.block.id);
        if (known) Object.assign(known, event.block);
        else state.blocks.push({ ...event.block });
        break;
      }

      case "text_delta": {
        const block = state.blocks.find((b) => b.id === event.id);
        if (block) block.text += event.text;
        break;
      }

      case "block_update": {
        const block = state.blocks.find((b) => b.id === event.id);
        if (block) Object.assign(block, event);
        break;
      }

      // A frame carries only the fields its call named, so it is merged: a
      // tool says what it is doing once, then counts.
      case "progress": {
        const block = state.blocks.find((b) => b.id === event.toolId);
        if (block?.kind === "tool") {
          const { type, toolId, ...fields } = event;
          block.progress = { ...block.progress, ...fields };
        }
        break;
      }

      case "ui_open": {
        if (state.surfaces.has(event.handle)) break; // shown already: a rejoin's catch-up
        // A revision of a surface on screen takes over its record in place:
        // its component, element and state stay, its handle moves on, and its
        // props stay until the new ones arrive, so the transcript keeps the
        // same element rather than mounting afresh.
        const old = event.replaces === undefined ? undefined : state.surfaces.get(event.replaces);
        let surface;
        if (old) {
          state.surfaces.delete(old.handle);
          Object.assign(old, { handle: event.handle, component: event.component, version: event.version, revising: true });
          state.surfaces.set(event.handle, (surface = old));
          const block = state.blocks.find((b) => b.kind === "ui" && b.handle === event.replaces);
          if (block) block.handle = event.handle;
        } else {
          surface = {
            handle: event.handle,
            component: event.component,
            version: event.version,
            mode: event.mode,
            state: "live",
            props: null,
            instance: null,
            element: null,
          };
          state.surfaces.set(event.handle, surface);
          state.blocks.push({ kind: "ui", id: `ui:${event.handle}`, handle: event.handle, toolId: event.toolId });
        }
        // Notices come on a stream of their own, so one can arrive before the
        // surface it names: it went to the end then, and moves under it now.
        // Moved within the same array, which the transcript would otherwise
        // take for a new conversation's.
        const early = state.blocks.filter((b) => b.kind === "notice" && b.handle === event.handle);
        for (const notice of early) state.blocks.splice(state.blocks.indexOf(notice), 1);
        state.blocks.splice(state.blocks.findIndex((b) => b.kind === "ui" && b.handle === event.handle) + 1, 0, ...early);
        // Each surface keeps its own deadline: from when the request that
        // rendered it was sent or, by its age, from when it was stored,
        // whichever is earlier. A revision brings its own, and the one it
        // replaced stops counting.
        if (typeof event.staleAfterMs === "number") {
          const from = typeof event.ageMs === "number" ? Math.min(sentAt, Date.now() - event.ageMs) : sentAt;
          surface.deadline = from + event.staleAfterMs;
          surface.window = event.staleAfterMs;
        } else {
          surface.deadline = null;
        }
        refreshDeadline();
        break;
      }

      case "ui_props": {
        const surface = state.surfaces.get(event.handle);
        if (!surface) break;
        surface.props = event.props;
        if (surface.revising) {
          // A revision's props reach the component already mounted: through
          // its `update`, keeping its own state, or by mounting it again.
          surface.revising = false;
          const { instance, element } = surface;
          if (instance && typeof instance.update === "function") attempt(() => instance.update(event.props));
          else if (instance && element) mount(surface.handle, element);
        }
        break;
      }

      case "ui_state": {
        const surface = state.surfaces.get(event.handle);
        if (surface) {
          surface.state = event.state;
          // kept, so a surface mounted again once frozen still knows the answer
          surface.selection = event.selection;
          surface.instance?.freeze?.(event.selection);
        }
        break;
      }

      case "status":
        state.status = event.status;
        break;

      case "context":
        state.context = event;
        break;

      case "error":
        state.blocks.push({ kind: "error", id: `e${state.blocks.length}`, message: event.message });
        state.status = "idle";
        break;

      // The local timer and the server can both report this; once is enough.
      case "expired":
        if (state.expired) return;
        state.expired = event.message;
        state.status = "idle";
        clearTimeout(timer);
        state.blocks.push({ kind: "expired", id: `x${state.blocks.length}`, message: event.message });
        for (const surface of state.surfaces.values()) seal(surface);
        break;
    }
    notify(event);
  }

  // ── notices ────────────────────────────────────────────────────────
  // A GET that stays open, read the same way as a turn's stream. It ends when
  // the conversation does — reset() or close() — and otherwise reconnects,
  // resuming after the last notice it saw. An out-of-date conversation keeps
  // it: a confirmation is still true once fares have gone stale.

  function listen(conversationId) {
    if (listening === conversationId || shutDown) return;
    listenAborter?.abort();
    listenAborter = new AbortController();
    listening = conversationId;
    void follow(conversationId, generation, listenAborter.signal);
  }

  async function follow(conversationId, gen, signal) {
    let wait = 1_000;
    while (gen === generation && !signal.aborted) {
      // A connection that delivered a notice, or stayed up a while, was
      // healthy, and the next drop starts the backoff over. One that drops
      // straight after it opens was not, however often the server says 200.
      const opened = Date.now();
      let delivered = false;
      try {
        const last = state.notices.at(-1)?.seq ?? 0;
        const res = await fetch(`${endpoint}/events?conversationId=${encodeURIComponent(conversationId)}`, {
          headers: last ? { "last-event-id": String(last) } : {},
          signal,
        });
        // the server has no such conversation, or sends no notices: stop
        if (res.status === 404) return;
        if (res.ok) {
          const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
          let buffer = "";
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += value;
            let i;
            while ((i = buffer.indexOf("\n\n")) >= 0) {
              if (gen !== generation) return;
              const frame = buffer.slice(0, i);
              buffer = buffer.slice(i + 2);
              const line = frame.split("\n").find((l) => l.startsWith("data: "));
              if (line) {
                const event = JSON.parse(line.slice(6));
                followTurn(event);
                apply(event);
                delivered = true;
              }
            }
          }
        }
      } catch {
        if (signal.aborted) return finishRemote();
      }
      // A turn cut off with its connection runs on, but nothing will say when
      // it ends: stop waiting for it, and give the next request longer instead.
      if (remote) cutOff = true;
      finishRemote();
      if (delivered || Date.now() - opened >= HEALTHY_MS) wait = 1_000;
      // Dropped, refused, or the network went away: try again, backing off.
      // reset() or close() ends the wait at once, timer and all.
      await new Promise((resolve) => {
        const done = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", done);
          resolve();
        };
        const timer = setTimeout(done, wait);
        signal.addEventListener("abort", done);
      });
      wait = Math.min(wait * 2, 30_000);
    }
  }

  /**
   * Track a wake turn on the events stream: it starts with a `streaming`
   * status, and is done with `released`, which the server sends only once it
   * has saved the conversation and let it go. Its `idle` status comes before
   * that save, so a message sent on it would still find the conversation held.
   */
  function followTurn(event) {
    if (event.type === "status" && event.status === "streaming") {
      if (!remote) remote = new Promise((resolve) => (endRemote = resolve));
      // surfaces it shows are stamped after this, as a request's are after it is sent
      sentAt = Date.now();
    } else if (event.type === "released") {
      finishRemote();
    }
  }

  function finishRemote() {
    remote = null;
    endRemote();
  }

  function stopListening() {
    finishRemote();
    listenAborter?.abort();
    listenAborter = null;
    listening = null;
  }

  /**
   * Mount a notice into an element, from the `notices` registry. As with
   * surfaces, a name the registry doesn't list renders an error card, never
   * an improvised UI. A notice has no `send`: it cannot reach the server.
   */
  function mountNotice(seq, element) {
    const notice = state.notices.find((n) => n.seq === seq);
    if (shutDown || !notice) return null;
    unmountNotice(seq);

    const definition = notices[notice.name];
    if (!definition) {
      element.textContent = `unknown notice: ${notice.name}`;
      element.className = "hai-surface-error";
      return null;
    }
    element.replaceChildren();
    // a component may return nothing; the promise is an instance or null
    const instance =
      definition.mount(element, notice.payload, { seq, version: notice.version, handle: notice.handle }) ?? null;
    noticeMounts.set(seq, instance);
    return instance;
  }

  function unmountNotice(seq) {
    const instance = noticeMounts.get(seq);
    noticeMounts.delete(seq);
    attempt(() => instance?.unmount?.());
  }

  // ── expiry ─────────────────────────────────────────────────────────
  // The server refuses every request on an out-of-date conversation. Knowing
  // the deadline here too means a tab left open greys out on time, rather than
  // looking live until a click comes back refused.

  let timer = null;
  let closingWindow = 0;

  const outOfDate = () => state.expiresAt !== null && Date.now() >= state.expiresAt;

  const expireHere = () =>
    apply({
      type: "expired",
      message:
        `This conversation is out of date — results shown here were only valid for ` +
        `${duration(closingWindow)}. Start a new conversation for current results.`,
    });

  /** The earliest deadline among the surfaces showing, and which window set it. */
  function refreshDeadline() {
    let soonest = null;
    for (const surface of state.surfaces.values()) {
      if (surface.deadline != null && (soonest === null || surface.deadline < soonest.deadline)) soonest = surface;
    }
    state.expiresAt = soonest?.deadline ?? null;
    if (soonest) closingWindow = soonest.window;
    schedule();
  }

  // One timer, for the earliest deadline. setTimeout fires at once for delays
  // past about 24.8 days, so a long wait is taken in steps.
  function schedule() {
    clearTimeout(timer);
    if (state.expiresAt === null || state.expired) return;
    const wait = Math.min(Math.max(state.expiresAt - Date.now(), 0), 2_147_483_647);
    timer = setTimeout(() => (outOfDate() ? expireHere() : schedule()), wait);
  }

  /** Checked against the clock as well as the flag: a laptop that slept
   *  through the deadline may not have run the timer yet. */
  function closed() {
    if (!state.expired && outOfDate()) expireHere();
    return state.expired !== null;
  }

  /** Nothing inside an out-of-date surface may reach the server again. */
  function seal(surface) {
    if (!surface.element) return;
    surface.element.inert = true;
    surface.element.dataset.expired = "";
    surface.instance?.expire?.();
  }

  /**
   * Mount a surface into an element. Strict allowlist: an unregistered
   * component renders an error card, never an improvised UI.
   *
   * One instance per surface. Mounting it again, into this element or another,
   * unmounts the one before, so nothing that instance set up outlives it.
   */
  function mount(handle, element) {
    const surface = state.surfaces.get(handle);
    if (shutDown || !surface || !surface.props) return null;
    unmount(surface);

    const definition = registry[surface.component];
    if (!definition) {
      element.textContent = `unknown component: ${surface.component}`;
      element.className = "hai-surface-error";
      return null;
    }

    element.replaceChildren();
    surface.element = element;
    surface.instance = definition.mount(element, surface.props, {
      handle,
      mode: surface.mode,
      state: surface.state,
      selection: surface.selection,
      // The ONLY channel a component has to the server. It passes an action
      // name declared in the contract — never a tool, never a handler.
      // and names the surface as it is now: a revision moves it on.
      send: (action, value) => interact(surface.handle, action, value),
    });
    if (state.expired) seal(surface);
    return surface.instance;
  }

  /**
   * Let a surface's instance go. A component that throws on its way out still
   * goes: the error is reported, not allowed to stop a reset or a close part
   * way through.
   */
  function unmount(surface) {
    const { instance } = surface;
    surface.instance = null;
    surface.element = null;
    attempt(() => instance?.unmount?.());
  }

  // A message is queued, never refused for being busy. It resolves to whether
  // the server took it: false if the conversation went out of date first —
  // at the call, or while it waited behind a long turn — if reset() started
  // a new one before its turn, or if the server was still busy after the
  // retry. A caller that cleared its input can then give the text back. The
  // out-of-date refusal at the call happens before the first await, so such a
  // caller can also check `state.expired` straight after calling and never
  // clear the input at all.
  async function send(text) {
    if (shutDown || !text.trim() || closed()) return false;
    return enqueue("/chat", { message: text });
  }

  /**
   * Whether the server has recorded this conversation's opening — init's call,
   * or a first message — as its last `context` shows. Having a conversation id
   * is not enough: `hello` arrives before init runs, and an init that throws
   * leaves the id behind with an empty history.
   */
  const begun = () => state.context.messages.length > 0;

  /**
   * Start the conversation before the user types, so a server with an init
   * tool runs it now and whatever it shows is there first. Does nothing once
   * the conversation has begun. If init throws, the server records nothing,
   * so calling this again tries again — as the first message would. A server
   * without an init tool answers with an empty stream and creates nothing;
   * the first message starts the conversation, as it always has. Resolves
   * like send().
   */
  async function start() {
    if (shutDown || begun() || closed()) return false;
    return enqueue("/start", {});
  }

  // A click carries nothing the user authored, and stacking them is worse than
  // dropping them: a double-click on a picker row would resolve it and then
  // queue a second resolution into "component is frozen". The deadline is
  // checked first, so a click that cannot be sent still closes a conversation
  // whose timer slept through its deadline.
  async function interact(handle, action, value) {
    if (shutDown || closed() || busy) return;
    await enqueue("/interact", { handle, action, value });
  }

  /**
   * Start over. The next send begins a new conversation. Anything queued for
   * the old one is never sent, anything still open is aborted, and every
   * surface it showed is unmounted.
   */
  function reset() {
    if (shutDown) return;
    generation++;
    aborter.abort();
    aborter = new AbortController();
    stopListening();
    cutOff = false;
    clearTimeout(timer);
    for (const surface of state.surfaces.values()) unmount(surface);
    for (const seq of [...noticeMounts.keys()]) unmountNotice(seq);
    Object.assign(state, {
      conversationId: null,
      status: "idle",
      blocks: [],
      context: { messages: [], modelTokens: 0, uiTokens: 0 },
      expiresAt: null,
      expired: null,
      notices: [],
    });
    state.surfaces.clear();
    notify({ type: "reset" });
  }

  /**
   * Done with this chat for good, as when the page that showed it goes away.
   * Anything queued is never sent, anything open is aborted, every surface is
   * unmounted, and subscribers hear `{ type: "closed" }` so they can let go of
   * what they hold. From then on the chat does nothing.
   */
  function close() {
    if (shutDown) return;
    shutDown = true;
    generation++;
    aborter.abort();
    stopListening();
    clearTimeout(timer);
    for (const surface of state.surfaces.values()) unmount(surface);
    for (const seq of [...noticeMounts.keys()]) unmountNotice(seq);
    // Every subscriber hears it, even after one that throws, and none is held
    // on to: they are let go of before they are told.
    const subscribers = [...listeners];
    listeners.clear();
    for (const fn of subscribers) attempt(() => fn(state, { type: "closed" }));
  }

  return {
    state,
    start,
    send,
    interact,
    mount,
    mountNotice,
    reset,
    close,
    subscribe(fn) {
      // a closed chat tells no one anything again, so it keeps no one either
      if (shutDown) return () => {};
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/**
 * How long a request keeps trying a conversation held by a wake turn whose
 * events connection dropped: the default lease, the longest that turn can
 * hold it.
 */
const CUT_OFF_MS = 120_000;

/** An events connection that stays up this long was healthy, whatever it delivered. */
const HEALTHY_MS = 30_000;

/**
 * Run `fn`, reporting what it throws without letting it stop the caller: the
 * error surfaces as an uncaught one would, after the caller has finished.
 */
function attempt(fn) {
  try {
    fn();
  } catch (err) {
    queueMicrotask(() => {
      throw err;
    });
  }
}

/** "2 hours", "15 minutes" — for a sentence a person reads. */
function duration(ms) {
  const units = [
    [86_400_000, "day"],
    [3_600_000, "hour"],
    [60_000, "minute"],
    [1_000, "second"],
  ];
  for (const [size, name] of units) {
    if (ms >= size) {
      const n = Math.floor(ms / size);
      return `${n} ${name}${n === 1 ? "" : "s"}`;
    }
  }
  return "under a second";
}
