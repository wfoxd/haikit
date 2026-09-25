import type { IncomingMessage, ServerResponse } from "node:http";
import { isConversationBusy } from "@haikit/core";
import type { Emit, WireEvent } from "@haikit/core";
import type { Hai } from "./runtime.js";

/**
 * Node http handler for the two routes. Returns true if it handled the request.
 *
 * Both routes stream SSE, because both can resume the agent loop. Note what the
 * interact route accepts: {handle, action, value} and nothing else. The client
 * cannot name a tool, a handler, or an action target.
 */
export function nodeHandler(hai: Hai, basePath = "/hai") {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method !== "POST" || !url.pathname.startsWith(basePath)) return false;

    const route = url.pathname.slice(basePath.length);
    if (route !== "/chat" && route !== "/interact") return false;

    const body = await readJson(req);

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
    if (route === "/chat") {
      emit({ type: "hello", conversationId: conversation.id, model: hai.config.model.id });
    }

    try {
      if (route === "/chat") {
        await hai.send(conversation, String(body.message ?? ""), emit);
      } else {
        await hai.interact(
          conversation,
          { handle: body.handle, action: body.action, value: body.value },
          emit,
        );
      }
    } catch (err) {
      emit({ type: "error", message: (err as Error).message });
    } finally {
      // The lease is per request. A turn that completed or parked already
      // cleared it; a turn that threw did not, and would otherwise strand the
      // conversation until the TTL expired.
      conversation.leaseUntil = null;
      await hai.config.store.saveConversation(conversation);
    }

    res.end();
    return true;
  };
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
