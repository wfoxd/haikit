/**
 * Smoke test: boots Rebook with the scripted guide and drives the demo the
 * way a visitor does, with the airline played by the ops routes. The trip
 * opens, the airline cancels, the guide speaks first, a typed question is
 * answered from data the model never saw, holds run out, seats go, the
 * traveller picks, the boarding pass is issued, and a gate change has the
 * guide speak up again.
 *
 * Catches what typechecking can't: wire protocol drift after a HaiKIT
 * upgrade, a wake turn that never starts, a revision that doesn't reach the
 * browser, a click the server should refuse and doesn't.
 *
 *   npm run smoke
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.SMOKE_PORT) || 5292;
const BASE = `http://127.0.0.1:${PORT}`;

let failures = 0;
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`);
  failures++;
};
const check = (pass, good, fail) => (pass ? ok(good) : bad(typeof fail === "function" ? fail() : fail));

// Every request has a deadline: a stream the server never ends fails the
// test instead of hanging it.
const DEADLINE = 15_000;

/** Read SSE frames from a response body, handing each event to `onEvent`. */
async function frames(res, onEvent) {
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += value;
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const line = buf.slice(0, i).split("\n").find((l) => l.startsWith("data: "));
      buf = buf.slice(i + 2);
      if (line) onEvent(JSON.parse(line.slice(6)));
    }
  }
}

/** A POST to one of HaiKIT's routes, read to the end of its stream. */
async function sse(route, body) {
  const events = [];
  const res = await fetch(`${BASE}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(DEADLINE),
  });
  await frames(res, (e) => events.push(e));
  return events;
}

/**
 * The conversation's events stream, kept open: what the airline does arrives
 * here, and wake turns start from it. `until` waits for an event to match.
 */
function watch(conversationId) {
  const events = [];
  const aborter = new AbortController();
  let wake = () => {};
  fetch(`${BASE}/hai/events?conversationId=${conversationId}`, { signal: aborter.signal })
    .then((res) => frames(res, (e) => (events.push(e), wake())))
    .catch(() => {});
  return {
    events,
    /** The first event from `from` on that matches, within `ms`. */
    async until(match, ms = 8_000, from = 0) {
      const deadline = Date.now() + ms;
      for (;;) {
        const hit = events.slice(from).find(match);
        if (hit) return hit;
        if (Date.now() > deadline) return null;
        await new Promise((r) => ((wake = r), setTimeout(r, 100)));
      }
    },
    close: () => aborter.abort(),
  };
}

const ops = (action, conversationId) =>
  fetch(`${BASE}/ops/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ conversationId }),
    signal: AbortSignal.timeout(DEADLINE),
  }).then(async (r) => ({ status: r.status, ...(await r.json()) }));

const opened = (evs, component) => evs.filter((e) => e.type === "ui_open" && e.component === component);
const propsOf = (evs, handle) => evs.find((e) => e.type === "ui_props" && e.handle === handle)?.props;
const lastStatus = (evs) => evs.filter((e) => e.type === "status").at(-1)?.status;
const said = (evs) => evs.filter((e) => e.type === "text_delta").map((e) => e.text).join("");
const digestOf = (evs, re) => evs.find((e) => e.type === "block_update" && re.test(e.result ?? ""))?.result ?? "";
const refusal = (evs) => evs.find((e) => e.type === "error")?.message ?? "";
const surface = (evs, component) => {
  const ui = opened(evs, component).at(-1);
  return { ui, props: propsOf(evs, ui?.handle) };
};

async function waitFor(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1_000) })).ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

console.log("\nrebook");
const child = spawn(process.execPath, ["src/server/main.ts"], {
  cwd: APP,
  env: { ...process.env, HAI_SCRIPTED: "1", PORT: String(PORT) },
  stdio: ["ignore", "ignore", "pipe"],
});
let stderr = "";
child.stderr.on("data", (d) => (stderr += d));

try {
  if (!(await waitFor(`${BASE}/healthz`))) {
    bad(`server did not start\n${stderr}`);
  } else {
    ok("boots");
    for (const asset of ["/", "/components.js", "/ops.js", "/styles.css", "/hai-client/app.js", "/hai-client/hai.css"]) {
      const res = await fetch(`${BASE}${asset}`);
      check(res.ok, `serves ${asset}`, `${asset} → ${res.status}`);
    }

    // 1 · the trip opens, and nothing happens until the airline does something
    const start = await sse("/hai/start", {});
    const id = start.find((e) => e.type === "hello")?.conversationId;
    const trip = surface(start, "trip_card");
    check(trip.ui?.mode === "display" && trip.props?.status === "on-time", "the conversation opens on the trip card, on time", () => JSON.stringify(trip));
    check(lastStatus(start) === "idle" && !said(start), "the guide doesn't speak until something happens", `status ${lastStatus(start)}, said ${said(start)}`);
    for (const [action, why] of [["release", /No rebooking options/], ["gate", /no boarding pass yet/]]) {
      const r = await ops(action, id);
      check(r.status === 409 && why.test(r.message), `ops ${action} before its time is refused: “${r.message}”`, () => JSON.stringify(r));
    }
    const nobody = await ops("cancel", "no-such-conversation");
    check(nobody.status === 409, "ops on a conversation that doesn't exist is refused", () => JSON.stringify(nobody));

    // 2 · the airline cancels; the guide speaks first, and the picker waits
    const stream = watch(id);
    const cancel = await ops("cancel", id);
    check(cancel.status === 200, `ops cancel: “${cancel.message}”`, () => JSON.stringify(cancel));
    const notice = await stream.until((e) => e.type === "notice" && e.name === "flight_cancelled");
    check(notice?.payload?.flight === "UA 837" && notice.handle, "a flight_cancelled notice arrives beside the trip card", () => JSON.stringify(notice));
    const revisedTrip = await stream.until((e) => e.type === "ui_props" && e.props?.status === "cancelled");
    check(revisedTrip?.props?.reason === "a crew shortage", "the trip card is revised in place to cancelled", () => JSON.stringify(revisedTrip));
    const pickerOpen = await stream.until((e) => e.type === "ui_open" && e.component === "rebooking_options");
    await stream.until((e) => e.type === "status" && e.status === "awaiting");
    const woken = said(stream.events);
    check(/^I'm sorry: your 18:05 UA 837 to Tokyo was cancelled because of a crew shortage/.test(woken), `the guide speaks first: “${woken.slice(0, 70)}…”`, `the guide said: ${woken}`);
    check(pickerOpen?.mode === "elicit" && pickerOpen.staleAfterMs === 20 * 60_000, "the options wait for a click, valid for 20 minutes", () => JSON.stringify(pickerOpen));
    const picker = propsOf(stream.events, pickerOpen?.handle);
    check(
      picker?.options?.length === 14 && picker.held && picker.options.every((o, i, a) => i === 0 || a[i - 1].laterMin <= o.laterMin),
      "14 options, held, the first to land first",
      () => JSON.stringify(picker?.options?.map((o) => o.id)),
    );
    const digest = digestOf(stream.events, /^Rebooking options/);
    check(
      /Lands first: ZG 25 .*Lands first at no extra cost: UA 1720 \+ NH 105 .*Nonstop: 5\. No extra cost: 8\. Leaving tonight: 6\./.test(digest),
      `the model gets a digest (~${Math.ceil(digest.length / 4)} tok) of options that stay in the browser (~${Math.ceil(JSON.stringify(picker).length / 4)} tok)`,
      `options digest: ${digest}`,
    );
    const again = await ops("cancel", id);
    check(again.status === 409 && /already cancelled/.test(again.message), "the flight can't be cancelled twice", () => JSON.stringify(again));
    const forged = await sse("/hai/interact", { conversationId: id, handle: pickerOpen?.handle, action: "choose", value: "o99" });
    check(/no option o99/.test(refusal(forged)), "a choice the picker doesn't offer is refused", () => refusal(forged));

    // 3 · a typed question, answered from data the model never received, then shown as a picker
    const typed = await sse("/hai/chat", { conversationId: id, message: "which ones are nonstop?" });
    check(typed.some((e) => e.type === "ui_state" && e.handle === pickerOpen?.handle && e.state === "frozen"), "typing closes the waiting picker", "the picker stayed open");
    const query = typed.find((e) => e.type === "block_update" && /^5 of 14 match/.test(e.result ?? ""));
    check(query && /ZG 25 .*NH 7 /s.test(query.result), "query_ui answers from the stored options, capped: “5 of 14 match”", () => JSON.stringify(typed.filter((e) => e.type === "block_update").map((e) => e.result)));
    const nonstops = surface(typed, "rebooking_options");
    check(
      nonstops.ui?.mode === "elicit" && nonstops.props?.options.length === 5 && nonstops.props.filter === "nonstops" && nonstops.props.total === 14,
      "…and the guide shows the 5 nonstops as a new picker",
      () => JSON.stringify({ ...nonstops.props, options: nonstops.props?.options.map((o) => o.id) }),
    );

    // 4 · the holds run out: the picker on screen is revised, and one option sells out
    const mark = stream.events.length;
    const release = await ops("release", id);
    check(release.status === 200 && /UA 875 sold out/.test(release.message), `ops release: “${release.message}”`, () => JSON.stringify(release));
    const released = await stream.until((e) => e.type === "ui_open" && e.component === "rebooking_options" && e.replaces, 8_000, mark);
    const releasedProps = await stream.until((e) => e.type === "ui_props" && e.handle === released?.handle, 8_000, mark);
    const ua875 = releasedProps?.props?.options.find((o) => o.id === "o06");
    check(released?.replaces === nonstops.ui?.handle && releasedProps?.props?.held === false && ua875?.seatsLeft === 0, "the picker is revised in place: holds gone, UA 875 sold out", () => JSON.stringify(releasedProps));
    const soldOut = await sse("/hai/interact", { conversationId: id, handle: released?.handle, action: "choose", value: "o06" });
    check(/UA 875 sold out a moment ago/.test(refusal(soldOut)), "a sold-out option is refused, and the picker stays live", () => refusal(soldOut));

    // 5 · the traveller picks NH 7; other passengers take seats while they look
    const choose = await sse("/hai/interact", { conversationId: id, handle: released?.handle, action: "choose", value: "o05" });
    const seats = surface(choose, "seat_map");
    check(seats.ui?.mode === "elicit" && seats.props?.flight === "NH 7", "choosing NH 7 shows its seat map, waiting for a pick", () => JSON.stringify(seats.ui));
    check(/The airline's 5-minute holds ran out/.test(JSON.stringify(choose.find((e) => e.type === "context")?.messages ?? "")), "the model hears of the released holds with the click", "the release never reached the model");
    const seatMark = stream.events.length;
    const taken = await stream.until((e) => e.type === "ui_open" && e.component === "seat_map" && e.replaces, 8_000, seatMark);
    const takenProps = await stream.until((e) => e.type === "ui_props" && e.handle === taken?.handle, 8_000, seatMark);
    const freeBefore = seats.props?.rows.flatMap((r) => r.seats).filter((s) => !s.taken).length;
    const freeAfter = takenProps?.props?.rows.flatMap((r) => r.seats).filter((s) => !s.taken).length;
    check(freeAfter === freeBefore - 1, `another passenger takes a seat while the map is open (${freeBefore} free, then ${freeAfter})`, () => `${freeBefore} → ${freeAfter}`);
    const latestSeats = () => {
      const revisions = stream.events.filter((e) => e.type === "ui_open" && e.component === "seat_map");
      const handle = revisions.at(-1)?.handle ?? seats.ui?.handle;
      return { handle, props: propsOf(stream.events, handle) ?? seats.props };
    };
    const now = latestSeats();
    const all = now.props.rows.flatMap((r) => r.seats);
    const takenSeat = all.find((s) => s.taken);
    const tookIt = await sse("/hai/interact", { conversationId: id, handle: now.handle, action: "pick", value: takenSeat?.id });
    check(new RegExp(`seat ${takenSeat?.id} was taken a moment ago`).test(refusal(tookIt)), `a taken seat (${takenSeat?.id}) is refused, and the map stays live`, () => refusal(tookIt));
    const free = latestSeats().props.rows.flatMap((r) => r.seats).filter((s) => !s.taken).at(-1);
    const pick = await sse("/hai/interact", { conversationId: id, handle: latestSeats().handle, action: "pick", value: free?.id });
    const care = surface(pick, "care_options");
    check(care.ui?.mode === "elicit" && care.props?.choices.length === 3, `seat ${free?.id} picked; NH 7 leaves tomorrow, so the guide asks about tonight`, () => JSON.stringify(pick.filter((e) => e.type === "error" || e.type === "ui_open")));

    // 6 · where to spend tonight, then the boarding pass for exactly what was clicked
    const hotel = await sse("/hai/interact", { conversationId: id, handle: care.ui?.handle, action: "choose", value: "hotel" });
    const pass = surface(hotel, "boarding_pass");
    check(
      pass.ui?.mode === "display" && pass.props?.flight === "NH 7" && pass.props.seat === free?.id && /Hotel voucher/.test(pass.props.care ?? "") &&
        pass.props.gate === "G95" && pass.props.boards === "10:20",
      `the boarding pass: NH 7, seat ${free?.id}, gate G95, boarding 10:20, and the hotel`,
      () => JSON.stringify(pass.props),
    );
    check(lastStatus(hotel) === "idle" && /You're booked/.test(said(hotel)), `the guide wraps up: “${said(hotel).slice(0, 60)}…”`, () => said(hotel));
    const context = hotel.find((e) => e.type === "context");
    // the whole conversation: every digest, click and revision the model was told of, against every component's props
    check(context && context.uiTokens > 2 * context.modelTokens, `the browser holds ~${context?.uiTokens} tokens of components; the model's whole context is ~${context?.modelTokens}`, () => JSON.stringify({ model: context?.modelTokens, ui: context?.uiTokens }));
    const confirmed = await stream.until((e) => e.type === "notice" && e.name === "seat_confirmed", 6_000);
    check(confirmed?.handle === pass.ui?.handle && confirmed.payload.seat === free?.id, "the airline confirms the seat a moment later, beside the pass", () => JSON.stringify(confirmed));

    // 7 · the gate moves: the pass is revised, and the guide speaks up without being asked
    const gateMark = stream.events.length;
    const gate = await ops("gate", id);
    check(gate.status === 200 && /gate G99/.test(gate.message), `ops gate: “${gate.message}”`, () => JSON.stringify(gate));
    const moved = await stream.until((e) => e.type === "ui_props" && e.props?.gate === "G99", 8_000, gateMark);
    check(moved, "the boarding pass is revised in place to gate G99", "the pass was not revised");
    await stream.until((e) => e.type === "released", 8_000, gateMark);
    const headsUp = said(stream.events.slice(gateMark));
    check(/^Heads up: NH 7 moved from gate G95 to gate G99\. Boarding is still 10:20\. And the airline confirmed seat/.test(headsUp), `the guide speaks up: “${headsUp.slice(0, 64)}…”`, `the guide said: ${headsUp}`);

    // 8 · how many are rebooking now: presence, as a signal to every open tab
    const count = await stream.until((e) => e.type === "signal" && e.name === "rebooking", 6_000);
    check(count?.payload?.count >= 1, `an open tab hears how many are rebooking (${count?.payload?.count})`, "no rebooking signal");
    stream.close();

    // 9 · the boarding pass books only what the traveller clicked
    const { issueBoardingPass } = await import("../src/server/tools.ts");
    const early = await issueBoardingPass.run({}, { conversationId: "nobody", text: (model) => ({ model }) });
    check(/hasn't chosen an option yet/.test(early.model), "issue_boarding_pass refuses before the traveller has chosen", () => early.model);

    // 10 · each surface and notice has a component in the browser registry
    const registry = await fetch(`${BASE}/components.js`).then((r) => r.text());
    for (const component of ["trip_card", "rebooking_options", "seat_map", "care_options", "boarding_pass", "flight_cancelled", "seat_confirmed"]) {
      check(new RegExp(`\\b${component}\\s*:`).test(registry), `${component} is registered in components.js`, `${component} missing from components.js`);
    }
  }
} finally {
  child.kill("SIGKILL");
}

console.log(failures ? `\n${failures} check(s) failed\n` : "\nsmoke: all checks passed\n");
process.exit(failures ? 1 : 0);
