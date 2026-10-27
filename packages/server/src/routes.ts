import type { IncomingMessage, ServerResponse } from "node:http";
import { isConversationBusy, isStaleLease } from "@haikit/core";
import type { Emit, Gate, GateRoute, NoticeRecord, WireEvent } from "@haikit/core";
import type { Hai, WakeOutcome } from "./runtime.js";

/**
 * Node http handler for the three routes, and a fourth when the app sends
 * notices. Returns true if it handled the request. It never rejects: a request
 * that fails is answered, ended and logged (see `failed`).
 *
 * The three POST routes stream SSE: chat and interact because both can resume
 * the agent loop, start because the init tool it runs can render surfaces.
 * Note what the interact route accepts: {handle, action, value} and nothing
 * else. The client cannot name a tool, a handler, or an action target.
 *
 * `GET /events` streams a conversation's notices, and the turns `wake`
 * notices start. It accepts nothing from the browser beyond which
 * conversation, and where to resume.
 *
 * With a `gate`, every route asks it who is asking, and whether they may use
 * the conversation named, before anything else happens (see `Gate`).
 */
export function nodeHandler(hai: Hai, basePath = "/hai", options: NodeHandlerOptions = {}) {
  const maxBodyBytes = options.maxBodyBytes ?? MAX_BODY_BYTES;
  const gate = options.gate ?? null;
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://localhost");
    } catch {
      // Node accepts targets a URL can't parse, such as `//[`. None is under
      // a base path, which a URL always parses, so it's not ours: the app's.
      return false;
    }
    if (!url.pathname.startsWith(basePath)) return false;
    const route = url.pathname.slice(basePath.length);

    if (req.method === "GET" && route === "/events" && hai.streamsEvents) {
      try {
        await streamNotices(hai, req, res, url, gate);
      } catch (err) {
        failed(res, err);
      }
      return true;
    }

    if (req.method !== "POST") return false;
    if (route !== "/chat" && route !== "/interact" && route !== "/start") return false;

    try {
      await respond(hai, route, req, res, maxBodyBytes, gate);
    } catch (err) {
      failed(res, err);
    }
    return true;
  };
}

export interface NodeHandlerOptions {
  /**
   * The largest POST body read, in bytes. A longer one is answered 413 and not
   * kept: without a limit, one request could make the server hold any amount.
   * Default 1 MiB.
   */
  maxBodyBytes?: number;
  /**
   * Who may use the routes, and which conversations each may use. Without
   * one, a conversation id is all a request needs.
   */
  gate?: Gate;
}

/** How often an open events stream asks its gate again, so a revoked one ends. */
const GATE_RECHECK_MS = 60_000;
/** The longest delay a Node timer keeps; past it, one fires after about a millisecond. */
const MAX_TIMER_MS = 2_147_483_647;

/** A request turned away before any stream opens: the status, and why. */
function refuse(res: ServerResponse, status: number, error: string) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ error }));
}

/** The default `maxBodyBytes`: far past any message or click, and nowhere near harm. */
const MAX_BODY_BYTES = 1_048_576;

/**
 * A request that failed in a way the route has no event for, such as a store
 * error: the browser is told, the response ends, and the error is logged. It
 * is never thrown on to the server, where an unhandled rejection would take
 * the process down and leave the response open.
 */
function failed(res: ServerResponse, err: unknown) {
  console.error("[haikit] request failed:", err);
  const message = err instanceof Error ? err.message : String(err);
  if (!res.headersSent) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: message }));
  } else if (!res.writableEnded) {
    res.write(`data: ${JSON.stringify({ type: "error", message } satisfies WireEvent)}\n\n`);
    res.end();
  }
}

/** One of the three POST routes, once the request is known to be one. */
async function respond(
  hai: Hai,
  route: string,
  req: IncomingMessage,
  res: ServerResponse,
  maxBodyBytes: number,
  gate: Gate | null,
) {
  // Who is asking, before the body is read: a request turned away here costs
  // nothing more. Before `/start`'s empty answer too, so a page whose user
  // isn't signed in learns it as it opens, not at its first message.
  let principal = "";
  if (gate) {
    const admission = await gate.admit({ route: route.slice(1) as GateRoute, method: "POST", headers: req.headers });
    if (!admission.ok) return refuse(res, admission.status, admission.error);
    principal = admission.principal;
  }

  let body: Record<string, any>;
  try {
    body = await readJson(req, maxBodyBytes);
  } catch (err) {
    if (err instanceof TooLarge) {
      // The rest of the body is drained, not kept; `close` stops a client
      // sending another request after it on this connection.
      res.writeHead(413, { "content-type": "application/json", connection: "close" });
      res.end(JSON.stringify({ error: "the request body is too large" }));
      return;
    }
    return refuse(res, 400, "the request body must be a JSON object");
  }

  // Behind a gate, an id is a string or there is none; and a conversation
  // this principal may not use is answered as one that doesn't exist, before
  // it is loaded, so a stranger never holds its lease nor learns it's there.
  let requested: unknown = body.conversationId;
  if (gate) {
    requested = typeof requested === "string" && requested !== "" ? requested : undefined;
    if (requested !== undefined && !(await gate.allows(principal, requested as string))) {
      return refuse(res, 404, "unknown conversation");
    }
  }

  // A click names a conversation it was shown in. Loading an unknown id would
  // start an empty conversation whose id nobody is ever told (no `hello` goes
  // out here), so make sure it exists first, as `hai.wake` does.
  if (route === "/interact" && !(await exists(hai, requested))) return refuse(res, 404, "unknown conversation");

  // Nothing to run before the first message: answer with an empty stream and
  // create no conversation, so an app without init doesn't get one for every
  // page view. Its first message starts the conversation, as it always has.
  if (route === "/start" && !hai.config.init) {
    openSSE(res);
    res.end();
    return;
  }

  // Before the SSE stream opens, because a rejected load has no stream to
  // report into: busy is a 409, and anything else a 500 (see `failed`).
  let conversation;
  try {
    conversation = await hai.config.store.loadConversation(requested as string | undefined);
  } catch (err) {
    if (!isConversationBusy(err)) throw err;
    return refuse(res, 409, (err as Error).message);
  }

  const emit = openSSE(res);
  let superseded = false;
  try {
    // A conversation made for this request is the principal's before its id
    // goes out: the events stream the browser opens on `hello` is let in. If
    // that fails, the browser is told why and never learns the id, and the
    // lease is let go below.
    if (gate && conversation.id !== requested) await gate.created(principal, conversation.id);
    if (route === "/chat" || route === "/start") {
      emit({
        type: "hello",
        conversationId: conversation.id,
        model: hai.config.model.id,
        ...(hai.streamsEvents ? { events: true as const } : {}),
      });
    }
    if (route === "/chat") {
      await hai.send(conversation, String(body.message ?? ""), emit);
    } else if (route === "/start") {
      await hai.start(conversation, emit);
    } else {
      await hai.interact(
        conversation,
        { handle: body.handle, action: body.action, value: body.value },
        emit,
      );
    }
  } catch (err) {
    if (isStaleLease(err)) superseded = true;
    emit({ type: "error", message: (err as Error).message });
  } finally {
    // The lease lives exactly as long as the request. Releasing it any
    // earlier — when a turn parks, say — lets the client's next interaction
    // arrive before this request has finished writing, and the two turns
    // interleave on one conversation.
    //
    // Only the expiry is cleared. The token has to survive so the save below
    // can still prove this request is the rightful holder.
    conversation.leaseUntil = null;
    try {
      // A turn that already hit a fence knows its save would be rejected too;
      // attempting it only repeats the same error to the client.
      if (!superseded) await hai.config.store.saveConversation(conversation);
    } catch (err) {
      // Overtaken while we were slow: another turn already wrote newer state
      // under a fresh token. Dropping this write is the correct outcome, but
      // the client asked for something it is not getting, so say so. Any
      // other failure goes to `failed`, which says so too, ends the response
      // and logs it: the conversation stays held until its lease lapses.
      if (!isStaleLease(err)) throw err;
      emit({ type: "error", message: (err as Error).message });
    }
  }

  res.end();
}

/**
 * The longest a notice waits to be read. A store's `watch` makes it sooner;
 * this is what still finds a notice whose wake-up was lost.
 */
const POLL_MS = 2_000;
/**
 * A short fingerprint of signal values, by name: what a polling browser says it
 * has, so a poll knows whether the latest values are news to it. The client
 * computes the same (packages/client/src/index.js); change both together.
 */
export function signalsDigest(entries: [string, unknown][]): string {
  const text = JSON.stringify([...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(16);
}

/** How long a process keeps hearing a conversation's turns after its last stream closes. */
const WATCH_LINGER_MS = 60_000;
/** How long a wake turn that has ended is kept, for a poll that missed its end, and how many at most. */
const ENDED_TURN_KEPT_MS = 60_000;
const ENDED_TURNS_KEPT = 5;
/** The longest a poll holds when there is nothing new to send. */
const POLL_HOLD_MS = 15_000;
/** How long a poll waits after something new, for what comes with it, before it ends. */
const POLL_GATHER_MS = 250;
/** Proxies drop a stream that says nothing for long; a comment keeps it open. */
const HEARTBEAT_MS = 25_000;

/** Notices read from the store at a time, so a long backlog goes out page by page. */
const PAGE = 100;

/**
 * Stream a conversation's notices: every one after where the browser has got
 * to (`Last-Event-ID` on a reconnect, else `?after=`), then each as it lands.
 * Takes no lease and writes nothing. Each notice goes out as its payload; its
 * model text is not in it: that reaches the browser only as part of the
 * history, in the `context` event, once a turn has taken it in.
 *
 * Bounded both ways. The store is read a page at a time, so a conversation
 * with years of notices is never held in memory at once, and nothing more is
 * written while the socket is still taking what was, so a reader that is slow
 * cannot make the server buffer every notice for it.
 */
async function streamNotices(hai: Hai, req: IncomingMessage, res: ServerResponse, url: URL, gate: Gate | null) {
  const { store } = hai.config;
  const conversationId = url.searchParams.get("conversationId") ?? "";

  // Behind a gate: who is asking, and whether this conversation is theirs,
  // before anything is read. One they may not use is unknown to them.
  const ask = async () => {
    if (!gate) return { ok: true as const, principal: "" };
    const admission = await gate.admit({ route: "events", method: "GET", headers: req.headers });
    if (!admission.ok) return admission;
    if (!conversationId || !(await gate.allows(admission.principal, conversationId))) {
      return { ok: false as const, status: 404, error: "unknown conversation" };
    }
    return admission;
  };
  const admitted = await ask();
  if (!admitted.ok) return refuse(res, admitted.status, admitted.error);
  let until = "until" in admitted ? admitted.until : undefined;
  // A poll, for a browser behind a proxy that holds a stream back until it
  // ends: what's waiting, then the response ends, which any proxy delivers.
  // `poll=now` answers at once; `poll=1` holds until something new arrives,
  // or for `wait` ms (at most POLL_HOLD_MS) if nothing does.
  const poll = url.searchParams.get("poll");
  const polling = poll === "1" || poll === "now";
  // a fingerprint of the signal values the browser already has (signalsDigest)
  const hasSignals = url.searchParams.get("signals");
  // the last wake turn the browser saw end, by its number
  const sawTurn = Number(url.searchParams.get("turn") ?? 0);
  const asked = Number(url.searchParams.get("wait") ?? POLL_HOLD_MS);
  const holdMs = Number.isFinite(asked) ? Math.min(Math.max(asked, 0), POLL_HOLD_MS) : POLL_HOLD_MS;
  const resume = Number(req.headers["last-event-id"] ?? url.searchParams.get("after") ?? 0);
  let after = Number.isSafeInteger(resume) && resume > 0 ? resume : 0;

  const first = await store.getNotices(conversationId, after, PAGE);
  if (first === null) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "unknown conversation" }));
    return;
  }

  // Hearing other processes' wake turns is in place before the browser is
  // told its stream is open: a turn that starts after that is never missed.
  // Counted as watching from here, so nothing lets the entry go while this
  // stream is still being set up.
  const watchers = watchersOf(hai, conversationId);
  watchers.stay();
  watchers.pending++;
  try {
    await watchers.ready;
  } finally {
    watchers.pending--;
  }
  // An admission that lapsed while that was set up is asked again before
  // anything is sent, and a refusal now is answered as the first would have been.
  if (until !== undefined && Date.now() >= until) {
    let again;
    try {
      again = await ask();
    } catch (err) {
      // a gate that fails here is answered as one that fails first, and lets go too
      forgetWatchers(hai, conversationId, watchers);
      throw err;
    }
    if (!again.ok) {
      forgetWatchers(hai, conversationId, watchers);
      return refuse(res, again.status, again.error);
    }
    until = "until" in again ? again.until : undefined;
  }
  // gone while that was set up: its close has already been and gone
  if (req.destroyed || res.destroyed) return forgetWatchers(hai, conversationId, watchers);

  res.writeHead(200, {
    "content-type": "text/event-stream",
    // A proxy that buffers or transforms the stream holds frames back, and a
    // surface's freshness is counted from when it arrives: ask it not to.
    // (`x-accel-buffering` is nginx's.)
    "cache-control": "no-cache, no-transform",
    "x-accel-buffering": "no",
    connection: "keep-alive",
  });
  // Sent now, not with the first frame: with nothing to catch up on, that is a
  // heartbeat away, and the browser's request would hang open until then. A
  // comment with them, so the browser hears its first bytes at once: one that
  // hears nothing knows something on the way is holding the stream, and polls.
  res.flushHeaders();
  res.write(": open\n\n");
  const aborter = new AbortController();
  const { signal } = aborter;
  res.on("close", () => aborter.abort());

  // Resolves once the socket has taken what is queued, or the browser has gone.
  // Writes nothing once the stream is over: a revision's second frame waiting
  // behind its first must not go out after the admission has run out.
  const write = async (chunk: string) => {
    if (signal.aborted || res.writableEnded) return;
    if (res.write(chunk)) return;
    await new Promise<void>((resolve) => {
      const done = () => {
        res.off("drain", done);
        signal.removeEventListener("abort", done);
        resolve();
      };
      res.on("drain", done);
      signal.addEventListener("abort", done);
    });
  };

  // Something new for this browser: a poll ends a moment after it, to gather
  // what comes with it.
  let markFresh = () => {};
  const freshened = new Promise<void>((resolve) => (markFresh = resolve));

  // A frame out, and a stream the browser has left takes no more.
  const send = (event: WireEvent) => {
    if (!signal.aborted && !res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  // A wake turn's events go out as they come, one frame each.
  const emit: Emit = (event) => {
    send(event);
    markFresh();
  };
  // Every stream this process has open for the conversation hears a wake
  // turn, not only the one whose attempt won the lease: another tab shows the
  // reply too, and holds its requests until the turn lets go.
  watchers.streams.add(emit);
  // Signals from here on, starting with each one's latest; and it counts as
  // present. A signal only matters as its latest value, so a reader that has
  // fallen behind is sent just the newest of each once it catches up: a
  // stalled socket holds at most one per signal, never every one sent.
  const behind = new Map<string, WireEvent>();
  let draining = false;
  const flush = () => {
    draining = false;
    const pending = [...behind.values()];
    behind.clear();
    for (const event of pending) emitSignal(event);
  };
  const emitSignal: Emit = (event) => {
    if (event.type !== "signal") return emit(event);
    if (signal.aborted || res.writableEnded) return;
    if (res.writableNeedDrain || behind.size) {
      behind.set(event.name, event);
      if (!draining) {
        draining = true;
        res.once("drain", flush);
      }
      return;
    }
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  // A new signal is news. Each one's latest, sent as the stream opens, is
  // news to a poll only if the browser doesn't have those values yet, such as
  // one sent between two polls: every poll gets them, and a poll that always
  // ended on them would never wait.
  const replayed: [string, unknown][] = [];
  const closeStream = hai.streamOpened(
    conversationId,
    (event) => {
      emitSignal(event);
      markFresh();
    },
    (event) => {
      emitSignal(event);
      if (!polling || event.type !== "signal") return;
      // the latest are sent one after another, at once: compare once all are in
      if (!replayed.length) queueMicrotask(() => signalsDigest(replayed) !== hasSignals && markFresh());
      replayed.push([event.name, event.payload]);
    },
  );
  // Joining while a wake turn runs: what it has shown so far, starting with
  // its `streaming` status, so the browser holds requests until it lets go,
  // and the reply's later text has a block to land in.
  // A surface it shows is sent with its age, so the browser counts its
  // freshness from when the surface was stored, not from now.
  if (watchers.live) for (const event of watchers.shown) send(aged(event));
  else if (polling) {
    // A turn that ended between two polls, unseen: all it showed, its end
    // included, which is news. Then that no turn is running, which a browser
    // that saw nothing of one needs too, or it would wait for it for ever.
    // every one it missed, oldest first, if more than one ended meanwhile
    const missed = Number.isSafeInteger(sawTurn) ? watchers.ended.filter((turn) => turn.number > sawTurn) : [];
    for (const turn of missed) for (const event of turn.shown) send(aged(event));
    if (missed.length) markFresh();
    send({ type: "released" });
  }

  // Wake turns run beside the notice loop, so a notice never waits behind a
  // turn, nor behind the retries while another request holds the
  // conversation. One attempt at a time; a wake notice that lands meanwhile
  // asks for another once it is done.
  //
  // An attempt takes the conversation's lease and saves it, even when it
  // finds nothing to do, and a request that arrives meanwhile is turned away
  // busy. So it is made only when there may be something new: a wake notice,
  // read from the store by any stream here, past the last one an attempt here
  // settled. A polling browser opens a stream several times a minute; each
  // would otherwise take the lease.
  let waking: Promise<void> | null = null;
  let again = false;
  const wake = () => {
    if (!hai.wakes || signal.aborted) return;
    if (watchers.wakeRead <= watchers.wakeSettled) return;
    if (waking) {
      again = true;
      return;
    }
    waking = (async () => {
      do {
        again = false;
        // every wake notice read here so far: what the attempt settles, unless it fails
        const through = watchers.wakeRead;
        let wait = WAKE_RETRY_MS;
        let outcome: WakeOutcome = "busy";
        while (!signal.aborted && (outcome = await hai.wake(conversationId, watchers.turn())) === "busy") {
          await pause(wait, signal);
          wait = Math.min(wait * 2, WAKE_RETRY_MAX_MS);
          // Another stream here may have been the one holding it, with a turn
          // that settled these notices: taking the lease again finds nothing.
          if (through <= watchers.wakeSettled) break;
        }
        // A failed turn gives its notices back to wake again, so it settles
        // nothing: the next stream to open tries once more.
        if (outcome !== "busy" && outcome !== "failed") watchers.wakeSettled = Math.max(watchers.wakeSettled, through);
        // asked again meanwhile: only if a notice came that this one didn't settle
      } while (again && !signal.aborted && watchers.wakeRead > watchers.wakeSettled);
    })()
      .catch((err) => emit({ type: "error", message: (err as Error).message }))
      .finally(() => {
        waking = null;
        // a notice that asked between the loop's last look and now
        if (again) wake();
      });
  };

  // An update notice goes out as the revision it announces: the surface, with
  // how long ago it was stored, and its props. Only the last frame carries the
  // notice's id, so a stream cut off between the two resumes with both. A
  // revision whose payload is gone, swept with an old conversation's, is
  // passed over with its id alone, so a browser resumes after it rather than
  // being sent it again on every reconnect.
  const sendRevision = async (handle: string, replaces: string, seq: number) => {
    const record = await store.getPayload(handle, conversationId);
    if (signal.aborted) return;
    if (!record) return write(`id: ${seq}\n\n`);
    const window = typeof record.staleAfterMs === "number" ? record.staleAfterMs : undefined;
    const open: WireEvent = {
      type: "ui_open",
      handle,
      // no tool call made it: the browser keeps the row of the one it replaces
      toolId: "",
      component: record.component,
      version: record.version,
      mode: record.mode,
      ...(window === undefined ? {} : { staleAfterMs: window }),
      ageMs: Math.max(0, Date.now() - record.createdAt),
      replaces,
    };
    await write(`data: ${JSON.stringify(open)}\n\n`);
    await write(`id: ${seq}\ndata: ${JSON.stringify({ type: "ui_props", handle, props: record.props } satisfies WireEvent)}\n\n`);
  };

  // Everything after `after`, a page at a time, until a page comes back short.
  // A conversation deleted since the stream opened ends it: there is nothing
  // more to wait for, and the browser's reconnect is then refused.
  const catchUp = async (page: NoticeRecord[] | null = null) => {
    let woken = false;
    for (;;) {
      const records = page ?? (await store.getNotices(conversationId, after, PAGE));
      if (records === null) return aborter.abort();
      for (const n of records) {
        if (signal.aborted) return;
        if (n.seq <= after) continue;
        if (n.replaces !== undefined && n.handle !== undefined) {
          await sendRevision(n.handle, n.replaces, n.seq);
          after = n.seq;
          markFresh();
          if (n.kind === "wake") {
            woken = true;
            watchers.wakeRead = Math.max(watchers.wakeRead, n.seq);
          }
          continue;
        }
        const event: WireEvent = {
          type: "notice",
          seq: n.seq,
          name: n.name,
          version: n.version,
          payload: n.payload,
          ...(n.handle === undefined ? {} : { handle: n.handle }),
        };
        await write(`id: ${n.seq}\ndata: ${JSON.stringify(event)}\n\n`);
        after = n.seq;
        markFresh();
        if (n.kind === "wake") {
          woken = true;
          watchers.wakeRead = Math.max(watchers.wakeRead, n.seq);
        }
      }
      if (records.length < PAGE || signal.aborted) break;
      page = null;
    }
    if (woken) wake();
  };

  // a heartbeat is only for a stream gone quiet, never one already backed up
  const heartbeat = setInterval(() => res.writableNeedDrain || res.write(": ping\n\n"), HEARTBEAT_MS);
  // Behind a gate, a stream stays open only while its admission holds. It
  // ends when that runs out, on a timer that stays armed while the gate is
  // asked again, so a gate slow to answer can't hold it open past then; a
  // poll ends then too, rather than hold for the rest of its wait. And a
  // stream asks again every GATE_RECHECK_MS, ending when refused, so a sign-in
  // revoked meanwhile stops hearing; a poll isn't asked again, since each is
  // admitted afresh and holds 15 s at most. Timers of their own, since the
  // heartbeat is skipped on a backed-up stream.
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let recheck: ReturnType<typeof setTimeout> | undefined;
  const armExpiry = () => {
    clearTimeout(expiry);
    const at = until;
    if (at === undefined || signal.aborted) return;
    // a deadline further off than a timer can wait is waited for in steps
    const wait = Math.min(Math.max(0, at - Date.now()), MAX_TIMER_MS);
    expiry = setTimeout(() => (Date.now() >= at ? aborter.abort() : armExpiry()), wait);
  };
  const recheckGate = () => {
    ask().then(
      (admission) => {
        if (!admission.ok) return aborter.abort();
        until = "until" in admission ? admission.until : undefined;
        armExpiry();
        if (!signal.aborted) recheck = setTimeout(recheckGate, GATE_RECHECK_MS);
      },
      (err) => {
        // a gate that can't answer lets no one in, here as on a new request
        console.error("[haikit] an events stream's gate failed:", err);
        aborter.abort();
      },
    );
  };
  if (gate) {
    armExpiry();
    if (!polling) recheck = setTimeout(recheckGate, GATE_RECHECK_MS);
  }
  // An app that sends no notices has nothing stored to read: the stream is only
  // for signals, and stays open, reading nothing, until the browser leaves.
  const wakes = hai.sendsNotices ? wakeups(store.watch?.(conversationId, signal), signal)[Symbol.asyncIterator]() : null;
  const left = new Promise<void>((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", () => resolve(), { once: true });
  });
  const run = async () => {
    if (!wakes) return left;
    await catchUp(first);
    // A wake notice may be waiting from before this browser connected: one
    // that arrived while nobody watched, or while the conversation was busy.
    wake();
    // Watching starts before the next read, so a notice that landed after the
    // backlog was read is either in that read or wakes the loop.
    let next = wakes.next();
    await catchUp();
    while (!signal.aborted) {
      if ((await next).done) break;
      next = wakes.next();
      await catchUp();
    }
  };
  try {
    if (!polling) return await run();
    // A poll: the same reading, until something new has gone out and what
    // came with it has had a moment to follow, or the hold runs out.
    if (poll === "now") markFresh();
    let hold: ReturnType<typeof setTimeout> | undefined;
    const done = Promise.race([
      left,
      freshened.then(() => new Promise<void>((resolve) => setTimeout(resolve, POLL_GATHER_MS))),
      new Promise<void>((resolve) => (hold = setTimeout(resolve, holdMs))),
    ]);
    // a read that fails ends nothing early: the poll answers at its hold
    void run().catch((err) => console.error("[haikit] events poll failed:", err));
    await done;
    clearTimeout(hold);
  } finally {
    clearInterval(heartbeat);
    clearTimeout(expiry);
    clearTimeout(recheck);
    aborter.abort();
    closeStream();
    watchers.streams.delete(emit);
    if (!watchers.streams.size) forgetWatchers(hai, conversationId, watchers);
    await wakes?.return?.();
    res.end();
  }
}

/**
 * The events streams one process has open for a conversation, and the wake
 * turn they are watching, if any: one running here, or, through a store with
 * `publish` and `subscribe`, in another process.
 */
interface Watchers {
  streams: Set<Emit>;
  live: boolean;
  /**
   * What the running wake turn has shown so far, as the frames a stream that
   * joins now needs: each block once, with its text and status up to date,
   * then everything else in order. A turn's worth, dropped when it ends.
   */
  shown: WireEvent[];
  /**
   * The wake turns that ended in the past minute, the last few, oldest first:
   * each one's number and everything it showed, `released` included. A poll
   * is sent each one its browser hasn't seen end, since they may have ended
   * between two polls.
   */
  ended: { number: number; shown: WireEvent[] }[];
  /**
   * An emitter for one wake attempt in this process: its frames go to every
   * stream here and to the other processes, marked as one turn.
   */
  turn: () => Emit;
  /** Streams still being set up, which count as watching. */
  pending: number;
  /** Let this entry go, and stop hearing other processes for it. */
  forget: () => void;
  /**
   * A stream for the conversation opened: stop lingering. And its last stream
   * closed: keep hearing other processes a while, then let go. A browser that
   * polls comes back in moments, perhaps to another server, and a wake turn
   * that ends meanwhile, wherever it ran, has to be here to replay.
   */
  stay: () => void;
  leave: () => void;
  /** Settles once this process is listening for other processes' turns. */
  ready: Promise<void>;
  /**
   * The highest seq of a wake notice any stream here has read from the store,
   * whether or not an attempt has settled it yet: a stream that resumes past
   * it, reading nothing, still knows it's there. 0 until one is read.
   */
  wakeRead: number;
  /**
   * The highest wake notice seq a wake attempt here has settled: it woke,
   * found nothing to do, or was held back by `maxWakes`. A stream makes an
   * attempt only while `wakeRead` is past it. -1 until the first, so the first
   * stream this process opens for the conversation looks once, for an update
   * notice a revision still owes. Both come from the store, never from what a
   * browser says it has seen, since every stream here shares them.
   */
  wakeSettled: number;
}

/** Fold a wake turn's frame into what it has shown so far. */
function remember(shown: WireEvent[], event: WireEvent) {
  const block = (id: string) =>
    shown.find((e): e is Extract<WireEvent, { type: "block_start" }> => e.type === "block_start" && e.block.id === id)?.block;
  if (event.type === "block_start") shown.push({ ...event, block: { ...event.block } });
  else if (event.type === "text_delta") {
    const b = block(event.id);
    if (b && "text" in b) b.text += event.text;
  } else if (event.type === "block_update") {
    const b = block(event.id);
    if (b) Object.assign(b, { status: event.status, ms: event.ms, result: event.result });
  } else if (event.type === "progress") {
    const { type, toolId, ...fields } = event;
    const b = block(toolId);
    if (b?.kind === "tool") b.progress = { ...b.progress, ...fields };
  } else if (event.type === "ui_open") {
    const copy = { ...event };
    born.set(copy, Date.now() - (event.ageMs ?? 0));
    const replaced = event.replaces === undefined ? -1 : shown.findIndex((e) => e.type === "ui_open" && e.handle === event.replaces);
    if (replaced < 0) shown.push(copy);
    else {
      // A revision of a surface this turn showed takes its place: a stream
      // joining later sees the surface once, as it is now. Its old props go.
      // It keeps `replaces`, so a browser that did see the old one swaps it in
      // place rather than adding a second, and the old one's tool row, which
      // the browser keeps through a revision too.
      const before = shown[replaced] as Extract<WireEvent, { type: "ui_open" }>;
      copy.toolId = before.toolId;
      // and every handle the surface had before, for a browser that last saw
      // one of those and missed the revisions between
      const earlier = [...(before.alsoReplaces ?? []), ...(before.replaces === undefined ? [] : [before.replaces])];
      if (earlier.length) copy.alsoReplaces = earlier;
      shown[replaced] = copy;
      for (let i = shown.length - 1; i >= 0; i--) {
        const e = shown[i];
        if (e.type === "ui_props" && e.handle === event.replaces) shown.splice(i, 1);
      }
    }
  } else shown.push(event);
}

/**
 * When each remembered surface was stored, by this process's clock: from the
 * age its frame came with, so a slow digest counts. For a turn heard from
 * another process, the time on the wire between them does not.
 */
const born = new WeakMap<WireEvent, number>();

/** A remembered frame as it goes out now: a surface with how long ago it was stored. */
function aged(event: WireEvent): WireEvent {
  const at = born.get(event);
  return at === undefined || event.type !== "ui_open" ? event : { ...event, ageMs: Math.max(0, Date.now() - at) };
}

const watching = new WeakMap<Hai, Map<string, Watchers>>();

/**
 * Who this Hai is, among the processes sharing a store: what it publishes is
 * marked with it, so it can tell its own messages from others' when the
 * store hands them back.
 */
const origins = new WeakMap<Hai, string>();
const originOf = (hai: Hai) => {
  let origin = origins.get(hai);
  if (!origin) origins.set(hai, (origin = globalThis.crypto.randomUUID()));
  return origin;
};

function watchersOf(hai: Hai, conversationId: string): Watchers {
  let byConversation = watching.get(hai);
  if (!byConversation) watching.set(hai, (byConversation = new Map()));
  const map = byConversation;
  let watchers = byConversation.get(conversationId);
  if (!watchers) {
    const { store } = hai.config;
    const origin = originOf(hai);
    // Hearing other processes' wake turns lasts as long as this entry does.
    const hearing = new AbortController();
    let lingering: ReturnType<typeof setTimeout> | null = null;
    const forget = () => {
      if (map.get(conversationId) !== fresh || fresh.pending || fresh.streams.size || fresh.live || fresh.ended.length || lingering) return;
      map.delete(conversationId);
      hearing.abort();
    };

    // A wake turn's frame, to every stream here. `live` from its first
    // `streaming` until `released`, with what it has shown kept meanwhile,
    // for a stream that joins part way.
    //
    // Frames name their turn, and its number in the conversation. Frames
    // from different processes can arrive out of order between them, so an
    // old turn's frames, even its start, may come after the next turn's
    // start. A turn takes over only with a number at least as high as any
    // seen; anything but the current turn's frames is dropped.
    let current: string | null = null;
    let currentNumber: number | undefined;
    let newest = 0;
    const deliver = (event: WireEvent, turn: string, number: number | undefined) => {
      if (event.type === "status" && event.status === "streaming") {
        if (current !== turn) {
          if (number !== undefined && number < newest) return; // an older turn's late start
          current = turn;
          currentNumber = number;
          if (number !== undefined) newest = number;
          fresh.live = true;
          fresh.shown = [];
        }
      } else if (turn !== current) {
        return; // an old turn's, or one whose start this process never heard
      }
      remember(fresh.shown, event);
      if (event.type === "released") {
        // kept a while for a poll that missed the end, then let go
        if (currentNumber !== undefined) {
          const ended = { number: currentNumber, shown: fresh.shown };
          fresh.ended = [...fresh.ended, ended].slice(-ENDED_TURNS_KEPT);
          setTimeout(() => {
            fresh.ended = fresh.ended.filter((turn) => turn !== ended);
            forget();
          }, ENDED_TURN_KEPT_MS).unref?.();
        }
        current = null;
        fresh.live = false;
        fresh.shown = [];
      }
      for (const send of fresh.streams) send(event);
      // the turn outlived every stream that watched it: nothing left to keep
      if (!fresh.live && !fresh.streams.size && !fresh.pending) forget();
    };

    const fresh: Watchers = {
      streams: new Set(),
      live: false,
      shown: [],
      ended: [],
      forget,
      stay: () => {
        if (lingering) clearTimeout(lingering);
        lingering = null;
      },
      leave: () => {
        if (lingering) clearTimeout(lingering);
        lingering = setTimeout(() => {
          lingering = null;
          forget();
        }, WATCH_LINGER_MS);
        lingering.unref?.();
      },
      ready: Promise.resolve(),
      wakeRead: 0,
      wakeSettled: -1,
      // A wake turn running here: its frames to this process's streams, and,
      // through the store, to every other process's. All but `context`, the
      // whole history, which another tab gets with its own next request.
      pending: 0,
      turn: () => {
        const turn = globalThis.crypto.randomUUID();
        // its number, from the first frame of the turn
        let number: number | undefined;
        return (event) => {
          if (number === undefined && event.type === "status" && typeof event.wake === "number") number = event.wake;
          deliver(event, turn, number);
          if (store.publish && event.type !== "context") {
            store.publish(conversationId, JSON.stringify({ origin, turn, number, event })).catch(() => {
              // best effort: another process's tabs miss this frame
            });
          }
        };
      },
    };

    // A wake turn running in another process, heard through the store.
    const subscribed = store.subscribe?.(
      conversationId,
      (message) => {
        let heard: { origin?: string; turn?: string; number?: number; event?: WireEvent };
        try {
          heard = JSON.parse(message);
        } catch {
          return;
        }
        if (heard.origin !== origin && heard.event && typeof heard.turn === "string") {
          deliver(heard.event, heard.turn, typeof heard.number === "number" ? heard.number : undefined);
        }
      },
      hearing.signal,
    );
    // best effort: a store that couldn't start listening doesn't hold the stream up
    if (subscribed) fresh.ready = Promise.resolve(subscribed).catch(() => {});

    byConversation.set(conversationId, (watchers = fresh));
  }
  return watchers;
}

function forgetWatchers(_hai: Hai, _conversationId: string, watchers: Watchers) {
  // Kept while a wake turn runs, so a stream that joins later still hears it,
  // while any stream is open or being set up, while an ended turn is kept, and
  // for a while after the last stream closes. `forget` checks them all.
  watchers.leave();
}

/** The first wait before trying a wake turn again on a busy conversation, and the longest. */
const WAKE_RETRY_MS = 250;
const WAKE_RETRY_MAX_MS = 5_000;

/** Wait `ms`, or until `signal` aborts. */
const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done);
  });

/**
 * When the events route reads next: every POLL_MS, and sooner whenever the
 * store's `watch` says a notice may have landed. `watch` alone is not enough.
 * A wake-up can be lost, and a LISTEN connection can drop, and either would
 * leave the stream open on heartbeats with a notice it never reads. A `watch`
 * that ends or fails leaves the reads every POLL_MS to carry on.
 */
async function* wakeups(watch: AsyncIterable<void> | undefined, signal: AbortSignal): AsyncIterable<void> {
  const steps = watch?.[Symbol.asyncIterator]();
  // started now, so the watch is listening before the caller's next read
  let step: Promise<unknown> | null = steps?.next().then((r) => !r.done, () => false) ?? null;
  try {
    while (!signal.aborted) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;
      const tick = new Promise<"tick">((resolve) => {
        onAbort = () => resolve("tick");
        timer = setTimeout(onAbort, POLL_MS);
        signal.addEventListener("abort", onAbort);
      });
      const woke = await Promise.race(step ? [tick, step] : [tick]);
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort!);
      if (signal.aborted) return;
      // the watch stepped: listen for the next; it ended or failed: stop listening
      if (woke !== "tick") step = woke ? steps!.next().then((r) => !r.done, () => false) : null;
      yield;
    }
  } finally {
    await steps?.return?.();
  }
}

function openSSE(res: ServerResponse): Emit {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    // A proxy that buffers or transforms the stream holds frames back, and a
    // surface's freshness is counted from when it arrives: ask it not to.
    // (`x-accel-buffering` is nginx's.)
    "cache-control": "no-cache, no-transform",
    "x-accel-buffering": "no",
    connection: "keep-alive",
  });
  return (event: WireEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
}

/** Whether the store has a conversation with this id, by the cheapest read there is. */
async function exists(hai: Hai, id: unknown): Promise<boolean> {
  return typeof id === "string" && (await hai.config.store.getNotices(id, Number.MAX_SAFE_INTEGER, 1)) !== null;
}

/** A body longer than `maxBodyBytes`. */
class TooLarge extends Error {}

/**
 * The request body, as a JSON object; anything else, or a body that fails to
 * arrive, throws. One past `maxBytes` throws `TooLarge` as soon as it is, by
 * its declared length or by what has arrived. What is still to come is drained
 * and dropped: breaking off the read would destroy the socket, and the answer
 * with it.
 */
function readJson(req: IncomingMessage, maxBytes: number): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    if (Number(req.headers["content-length"]) > maxBytes) {
      req.resume();
      return reject(new TooLarge());
    }
    const chunks: Buffer[] = [];
    let size = 0;
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size <= maxBytes) return void chunks.push(chunk);
      req.off("data", onData);
      req.resume();
      reject(new TooLarge());
    };
    req.on("data", onData);
    req.on("error", reject);
    req.on("end", () => {
      try {
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString() || "{}");
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new TypeError("not a JSON object");
        resolve(body as Record<string, any>);
      } catch (err) {
        reject(err);
      }
    });
  });
}
