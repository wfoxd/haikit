/**
 * Rebook: the airline cancels your flight, and the AI tells you before you
 * ask, finds every way there, and books the one you click. Or ask it to book
 * your flight home: it fills in what it already knows, and you steer.
 *
 * Everything here is app code. HaiKIT contributes the agent loop, the two
 * channels, the parked turn, the notices and revisions, and query_ui.
 */

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHai, memoryStore, nodeHandler } from "@haikit/server";
import { anthropic } from "@haikit/anthropic";
import { OpsError, cancelFlight, changeGate, connectAirline, raiseFare, releaseHolds } from "./airline.ts";
import { notices } from "./notices.ts";
import { scripted } from "./scripted.ts";
import { surfaces } from "./surfaces.ts";
import { showTrip, tools } from "./tools.ts";

const PORT = Number(process.env.PORT) || 5190;
// No key, or HAI_SCRIPTED=1: the scripted guide, so the demo costs nothing to run.
const SCRIPTED = process.env.HAI_SCRIPTED === "1" || !process.env.ANTHROPIC_API_KEY;

const SYSTEM = `You are the rebooking desk in an airline's app, built with HaiKIT. Your tools show
components in the traveller's browser. You receive a short DIGEST of each,
ending with its handle (e.g. ui_02); the full data stays in the browser.

- The conversation opens on the traveller's trip card. Until the airline does
  something, there is nothing to do.
- Notifications can arrive when the traveller hasn't said anything. When the
  airline cancels the flight, say so in one or two sentences, then call
  find_rebooking. Don't wait to be asked.
- find_rebooking shows the options and waits until the traveller picks one.
  The picker is the question: don't also ask them to type a choice. To narrow
  the list, call it again with filters.
- When the traveller clicks, the question's result is its digest, then a line
  saying what they did: "The traveller chose …", "The traveller picked seat …".
  That line is their answer. Carry on from it, and don't ask them to choose
  again.
- Never state a fact about an option you haven't been told. The digest has
  the highlights; for anything else, use query_ui filter or earliest on the
  options' handle.
- After the traveller picks an option, call show_seat_map for it. After a
  seat, if the option leaves tomorrow, call offer_care. Then call
  issue_boarding_pass, which books exactly what the traveller clicked.
- A [UI update] means the airline revised something on screen: seats taken,
  holds released, a gate moved. Its new digest replaces the old one. If it
  matters to the traveller, tell them in one sentence.
- The traveller can also book their flight home, Tokyo to San Francisco: they
  ask, or click Book my flight home on the trip card. Call start_booking,
  passing the day if they named one. It shows the search filled in from the
  trip; don't ask for anything it already has.
- After they search, call show_flights. After they pick a flight, call
  show_fares for it. After a fare, call show_home_seats if the fare lets them
  choose a seat, otherwise review_booking; after a seat, review_booking.
- Nothing is booked until the traveller confirms the review. Then call
  issue_ticket, which books exactly what they confirmed. If they ask to change
  the flight, fare or seat, show that step again.
- Never state a price or a flight you haven't been told: use query_ui filter
  or cheapest on the flights' handle.
- Keep replies to one or two sentences.`;

const hai = createHai({
  model: SCRIPTED ? scripted() : anthropic({ model: process.env.HAI_MODEL || "claude-haiku-5-5", effort: "low" }),
  store: memoryStore(),
  init: showTrip, // the conversation opens on the trip card, and the model doesn't run
  // find_rebooking, show_seat_map, offer_care, issue_boarding_pass; and for the
  // flight home, start_booking, show_flights, show_fares, show_home_seats,
  // review_booking, issue_ticket
  tools,
  surfaces,
  notices, // flight_cancelled (wake), seat_confirmed, ticket_issued
  // the airline revises what's on screen with hai.update
  updates: true,
  // the cancellation wakes the guide, and a gate change a minute later does again
  maxWakes: { count: 3, perMs: 60_000 },
  system: SYSTEM,
});
connectAirline(hai.notify, hai.update);

const handleHai = nodeHandler(hai, "/hai");

// ─────────────────────────────────────────────────── the Airline ops panel

/** What the panel's buttons ask the airline to do, by route. */
const OPS: Record<string, (conversationId: string) => Promise<string>> = {
  "/ops/cancel": cancelFlight,
  "/ops/release": releaseHolds,
  "/ops/gate": changeGate,
  "/ops/fare": raiseFare,
};

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1_000) throw new Error("too long");
  }
  return JSON.parse(body || "null");
}

const json = (res: http.ServerResponse, status: number, value: unknown) =>
  void res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }).end(JSON.stringify(value));

async function handleOps(req: http.IncomingMessage, res: http.ServerResponse, act: (id: string) => Promise<string>) {
  if (req.method !== "POST") return json(res, 405, { message: "POST only" });
  const body = await readBody(req).catch(() => null);
  const id = body && typeof body === "object" ? (body as { conversationId?: unknown }).conversationId : undefined;
  if (typeof id !== "string" || !id) return json(res, 400, { message: "the body must be { conversationId }" });
  try {
    return json(res, 200, { message: await act(id) });
  } catch (err) {
    if (err instanceof OpsError) return json(res, 409, { message: err.message });
    console.error(`[rebook] ${req.url} failed:`, err);
    return json(res, 500, { message: "The airline couldn't do that just now." });
  }
}

// ─────────────────────────────────────────────────── static files

// This app's page, plus the client runtime served from wherever node resolves
// @haikit/client: the version installed in node_modules.
const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public");
const CLIENT = path.join(path.dirname(fileURLToPath(import.meta.resolve("@haikit/client/package.json"))), "src");
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = http.createServer(async (req, res) => {
  try {
    if (await handleHai(req, res)) return;
    const url = new URL(req.url ?? "/", "http://localhost");
    const op = OPS[url.pathname];
    if (op) return await handleOps(req, res, op);
    if (req.method !== "GET" && req.method !== "HEAD") return void res.writeHead(405).end();
    if (url.pathname === "/healthz") return void res.writeHead(200, { "content-type": "text/plain" }).end("ok");

    const clientPrefix = "/hai-client/";
    const [root, rel] = url.pathname.startsWith(clientPrefix)
      ? [CLIENT, url.pathname.slice(clientPrefix.length)]
      : [PUBLIC, url.pathname === "/" ? "index.html" : url.pathname.slice(1)];
    const file = path.join(root, rel);
    if (!file.startsWith(root + path.sep)) return void res.writeHead(403).end("forbidden");
    const body = await fs.readFile(file).catch(() => null);
    if (!body) return void res.writeHead(404).end("not found");
    res.writeHead(200, {
      "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
      "cache-control": "no-cache",
      "x-content-type-options": "nosniff",
    });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});

server.listen(PORT, () => {
  console.log(`rebook  http://localhost:${PORT}   model=${SCRIPTED ? "scripted guide" : hai.config.model.id}   store=memory`);
});

// Containers stop with SIGTERM: finish the requests in flight, then exit.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5_000).unref();
  });
}
