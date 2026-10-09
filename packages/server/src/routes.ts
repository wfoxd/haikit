import type { IncomingMessage, ServerResponse } from "node:http";
import { isConversationBusy, isStaleLease } from "@haikit/core";
import type { Emit, NoticeRecord, WireEvent } from "@haikit/core";
import type { Hai } from "./runtime.js";

/**
 * Node http handler for the three routes, and a fourth when the app sends
 * notices. Returns true if it handled the request.
 *
 * The three POST routes stream SSE: chat and interact because both can resume
 * the agent loop, start because the init tool it runs can render surfaces.
 * Note what the interact route accepts: {handle, action, value} and nothing
 * else. The client cannot name a tool, a handler, or an action target.
 *
 * `GET /events` streams a conversation's notices, and the turns `wake`
 * notices start. It accepts nothing from the browser beyond which
 * conversation, and where to resume.
 */
export function nodeHandler(hai: Hai, basePath = "/hai") {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith(basePath)) return false;
    const route = url.pathname.slice(basePath.length);

    if (req.method === "GET" && route === "/events" && hai.sendsNotices) {
      await streamNotices(hai, req, res, url);
      return true;
    }

    if (req.method !== "POST") return false;
    if (route !== "/chat" && route !== "/interact" && route !== "/start") return false;

    const body = await readJson(req);

    // Nothing to run before the first message: answer with an empty stream and
    // create no conversation, so an app without init doesn't get one for every
    // page view. Its first message starts the conversation, as it always has.
    if (route === "/start" && !hai.config.init) {
      openSSE(res);
      res.end();
      return true;
    }

    // Before the SSE stream opens, because a rejected load has no stream to
    // report into — and an uncaught throw here would take down the request.
    let conversation;
    try {
      conversation = await hai.config.store.loadConversation(body.conversationId);
    } catch (err) {
      if (!isConversationBusy(err)) throw err;
      res.writeHead(409, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: (err as Error).message }));
      return true;
    }

    const emit = openSSE(res);
    if (route === "/chat" || route === "/start") {
      emit({
        type: "hello",
        conversationId: conversation.id,
        model: hai.config.model.id,
        ...(hai.sendsNotices ? { events: true as const } : {}),
      });
    }

    let superseded = false;
    try {
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
        // the client asked for something it is not getting, so say so.
        if (!isStaleLease(err)) throw err;
        emit({ type: "error", message: (err as Error).message });
      }
    }

    res.end();
    return true;
  };
}

/**
 * The longest a notice waits to be read. A store's `watch` makes it sooner;
 * this is what still finds a notice whose wake-up was lost.
 */
const POLL_MS = 2_000;
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
async function streamNotices(hai: Hai, req: IncomingMessage, res: ServerResponse, url: URL) {
  const { store } = hai.config;
  const conversationId = url.searchParams.get("conversationId") ?? "";
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
  watchers.pending++;
  try {
    await watchers.ready;
  } finally {
    watchers.pending--;
  }
  // gone while that was set up: its close has already been and gone
  if (req.destroyed || res.destroyed) return forgetWatchers(hai, conversationId, watchers);

  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  // Sent now, not with the first frame: with nothing to catch up on, that is a
  // heartbeat away, and the browser's request would hang open until then.
  res.flushHeaders();
  const aborter = new AbortController();
  const { signal } = aborter;
  res.on("close", () => aborter.abort());

  // Resolves once the socket has taken what is queued, or the browser has gone.
  const write = async (chunk: string) => {
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

  // A wake turn's events go out as they come, one frame each, and a stream
  // the browser has left takes no more.
  const emit: Emit = (event) => {
    if (!signal.aborted && !res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  // Every stream this process has open for the conversation hears a wake
  // turn, not only the one whose attempt won the lease: another tab shows the
  // reply too, and holds its requests until the turn lets go.
  watchers.streams.add(emit);
  // Joining while a wake turn runs: what it has shown so far, starting with
  // its `streaming` status, so the browser holds requests until it lets go,
  // and the reply's later text has a block to land in.
  if (watchers.live) for (const event of watchers.shown) emit(event);

  // Wake turns run beside the notice loop, so a notice never waits behind a
  // turn, nor behind the retries while another request holds the
  // conversation. One attempt at a time; a wake notice that lands meanwhile
  // asks for another once it is done.
  let waking: Promise<void> | null = null;
  let again = false;
  const wake = () => {
    if (!hai.wakes || signal.aborted) return;
    if (waking) {
      again = true;
      return;
    }
    waking = (async () => {
      do {
        again = false;
        let wait = WAKE_RETRY_MS;
        while (!signal.aborted && (await hai.wake(conversationId, watchers.turn())) === "busy") {
          await pause(wait, signal);
          wait = Math.min(wait * 2, WAKE_RETRY_MAX_MS);
        }
      } while (again && !signal.aborted);
    })()
      .catch((err) => emit({ type: "error", message: (err as Error).message }))
      .finally(() => {
        waking = null;
        // a notice that asked between the loop's last look and now
        if (again) wake();
      });
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
        woken ||= n.kind === "wake";
      }
      if (records.length < PAGE || signal.aborted) break;
      page = null;
    }
    if (woken) wake();
  };

  // a heartbeat is only for a stream gone quiet, never one already backed up
  const heartbeat = setInterval(() => res.writableNeedDrain || res.write(": ping\n\n"), HEARTBEAT_MS);
  const wakes = wakeups(store.watch?.(conversationId, signal), signal)[Symbol.asyncIterator]();
  try {
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
  } finally {
    clearInterval(heartbeat);
    aborter.abort();
    watchers.streams.delete(emit);
    if (!watchers.streams.size) forgetWatchers(hai, conversationId, watchers);
    await wakes.return?.();
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
   * An emitter for one wake attempt in this process: its frames go to every
   * stream here and to the other processes, marked as one turn.
   */
  turn: () => Emit;
  /** Streams still being set up, which count as watching. */
  pending: number;
  /** Let this entry go, and stop hearing other processes for it. */
  forget: () => void;
  /** Settles once this process is listening for other processes' turns. */
  ready: Promise<void>;
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
  } else shown.push(event);
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
    const forget = () => {
      if (map.get(conversationId) !== fresh || fresh.pending || fresh.streams.size || fresh.live) return;
      map.delete(conversationId);
      hearing.abort();
    };

    // A wake turn's frame, to every stream here. `live` from its first
    // `streaming` until `released`, with what it has shown kept meanwhile,
    // for a stream that joins part way.
    //
    // Frames name their turn. Frames from different processes can arrive out
    // of order between them, so a turn's `released` may come after the next
    // turn has started elsewhere: anything but the current turn's frames is
    // dropped, and a new turn's `streaming` takes over from an old one.
    let current: string | null = null;
    const deliver = (event: WireEvent, turn: string) => {
      if (event.type === "status" && event.status === "streaming") {
        if (current !== turn) {
          current = turn;
          fresh.live = true;
          fresh.shown = [];
        }
      } else if (turn !== current) {
        return; // an old turn's, or one whose start this process never heard
      }
      remember(fresh.shown, event);
      if (event.type === "released") {
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
      forget,
      ready: Promise.resolve(),
      // A wake turn running here: its frames to this process's streams, and,
      // through the store, to every other process's. All but `context`, the
      // whole history, which another tab gets with its own next request.
      pending: 0,
      turn: () => {
        const turn = globalThis.crypto.randomUUID();
        return (event) => {
          deliver(event, turn);
          if (store.publish && event.type !== "context") {
            store.publish(conversationId, JSON.stringify({ origin, turn, event })).catch(() => {
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
        let heard: { origin?: string; turn?: string; event?: WireEvent };
        try {
          heard = JSON.parse(message);
        } catch {
          return;
        }
        if (heard.origin !== origin && heard.event && typeof heard.turn === "string") deliver(heard.event, heard.turn);
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
  // and while any stream is open or being set up. `forget` checks all three.
  watchers.forget();
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
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  return (event: WireEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString() || "{}");
}
