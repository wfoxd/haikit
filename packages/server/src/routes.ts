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

/** How long a notice waits to be read when the store has no `watch`. */
const POLL_MS = 2_000;
/** Proxies drop a stream that says nothing for long; a comment keeps it open. */
const HEARTBEAT_MS = 25_000;

/**
 * Stream a conversation's notices: every one after where the browser has got
 * to (`Last-Event-ID` on a reconnect, else `?after=`), then each as it lands.
 * Takes no lease and writes nothing. Each notice goes out as its payload; its
 * model text never leaves the server.
 */
async function streamNotices(hai: Hai, req: IncomingMessage, res: ServerResponse, url: URL) {
  const { store } = hai.config;
  const conversationId = url.searchParams.get("conversationId") ?? "";
  const resume = Number(req.headers["last-event-id"] ?? url.searchParams.get("after") ?? 0);
  let after = Number.isSafeInteger(resume) && resume > 0 ? resume : 0;

  const backlog = await store.getNotices(conversationId, after);
  if (backlog === null) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "unknown conversation" }));
    return;
  }

  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const send = (records: NoticeRecord[] | null) => {
    for (const n of records ?? []) {
      if (n.seq <= after) continue;
      const event: WireEvent = {
        type: "notice",
        seq: n.seq,
        name: n.name,
        version: n.version,
        payload: n.payload,
        ...(n.handle === undefined ? {} : { handle: n.handle }),
      };
      res.write(`id: ${n.seq}\ndata: ${JSON.stringify(event)}\n\n`);
      after = n.seq;
    }
  };
  send(backlog);

  const aborter = new AbortController();
  res.on("close", () => aborter.abort());
  const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
  const wakes = (store.watch?.(conversationId, aborter.signal) ?? every(POLL_MS, aborter.signal))[
    Symbol.asyncIterator
  ]();
  try {
    // Watching starts before the second read, so a notice that landed after
    // the backlog was read is either in that read or wakes the loop.
    let next = wakes.next();
    send(await store.getNotices(conversationId, after));
    while (!aborter.signal.aborted) {
      if ((await next).done) break;
      next = wakes.next();
      send(await store.getNotices(conversationId, after));
    }
  } finally {
    clearInterval(heartbeat);
    aborter.abort();
    await wakes.return?.();
    res.end();
  }
}

/** A wake-up every `ms` until `signal` aborts: what the events route reads on without `watch`. */
async function* every(ms: number, signal: AbortSignal): AsyncIterable<void> {
  while (!signal.aborted) {
    await new Promise<void>((r) => {
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", done);
        r();
      };
      const timer = setTimeout(done, ms);
      signal.addEventListener("abort", done);
    });
    if (!signal.aborted) yield;
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
