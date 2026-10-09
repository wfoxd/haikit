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
 * `GET /events` streams a conversation's notices. It accepts nothing from the
 * browser beyond which conversation, and where to resume.
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
 * model text never leaves the server.
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

  // Everything after `after`, a page at a time, until a page comes back short.
  // A conversation deleted since the stream opened ends it: there is nothing
  // more to wait for, and the browser's reconnect is then refused.
  const catchUp = async (page: NoticeRecord[] | null = null) => {
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
      }
      if (records.length < PAGE || signal.aborted) return;
      page = null;
    }
  };

  // a heartbeat is only for a stream gone quiet, never one already backed up
  const heartbeat = setInterval(() => res.writableNeedDrain || res.write(": ping\n\n"), HEARTBEAT_MS);
  const wakes = wakeups(store.watch?.(conversationId, signal), signal)[Symbol.asyncIterator]();
  try {
    await catchUp(first);
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
    await wakes.return?.();
    res.end();
  }
}

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
