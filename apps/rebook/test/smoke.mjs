/**
 * Smoke test: boots Rebook with the scripted guide and drives the demo the
 * way a visitor does, with the airline played by the ops routes. The trip
 * opens, the airline cancels, the guide speaks first, a typed question is
 * answered from data the model never saw, holds run out, seats go, the
 * traveller picks, the boarding pass is issued, and a gate change has the
 * guide speak up again. Then the flight home is booked: the search filled in
 * from the trip, a capped query, a fare, a seat, a fare raised while the
 * review waits, and the e-ticket for exactly what was confirmed.
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
    check(trip.ui?.mode === "display" && trip.props?.status === "on-time" && trip.props.home === null, "the conversation opens on the trip card, on time, no flight home yet", () => JSON.stringify(trip));
    check(lastStatus(start) === "idle" && !said(start), "the guide doesn't speak until something happens", `status ${lastStatus(start)}, said ${said(start)}`);
    for (const [action, why] of [["release", /No rebooking options/], ["gate", /no boarding pass yet/], ["fare", /No booking is waiting on its review/]]) {
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

    // 3b · a second question narrows the picker on screen: its answer and the picker that follows agree
    const free = await sse("/hai/chat", { conversationId: id, message: "which are free?" });
    const freeQuery = free.find((e) => e.type === "block_update" && /^\d+ of \d+ match/.test(e.result ?? ""));
    const narrowed = surface(free, "rebooking_options");
    const shownIds = narrowed.props?.options.map((o) => o.id).join(",");
    check(
      /^3 of 5 match/.test(freeQuery?.result ?? "") && narrowed.props?.filter === "nonstops, at no extra cost" && shownIds === "o06,o05,o08",
      "“which are free?” then asks the 5 nonstops, and shows the same 3: free nonstops",
      () => `query: ${freeQuery?.result?.split("\n")[0]}, picker: ${narrowed.props?.filter} ${shownIds}`,
    );

    // 3c · a question nothing matches: typing closed the picker, so the guide opens it again
    const tonight = await sse("/hai/chat", { conversationId: id, message: "which leave tonight?" });
    const none = tonight.find((e) => e.type === "block_update" && /^0 of 3 match/.test(e.result ?? ""));
    const reopened = surface(tonight, "rebooking_options");
    check(
      none && reopened.ui?.mode === "elicit" && reopened.props?.options.map((o) => o.id).join(",") === "o06,o05,o08" && lastStatus(tonight) === "awaiting",
      "“which leave tonight?” matches none of the 3, and the guide opens the same 3 again, waiting",
      () => `query: ${none?.result}, picker: ${reopened.props?.options.map((o) => o.id)}, status ${lastStatus(tonight)}`,
    );
    const narrowedOpen = reopened;

    // 4 · the holds run out: the picker on screen is revised, and one option sells out
    const mark = stream.events.length;
    const release = await ops("release", id);
    check(release.status === 200 && /UA 875 sold out/.test(release.message), `ops release: “${release.message}”`, () => JSON.stringify(release));
    const released = await stream.until((e) => e.type === "ui_open" && e.component === "rebooking_options" && e.replaces, 8_000, mark);
    const releasedProps = await stream.until((e) => e.type === "ui_props" && e.handle === released?.handle, 8_000, mark);
    const ua875 = releasedProps?.props?.options.find((o) => o.id === "o06");
    check(released?.replaces === narrowedOpen.ui?.handle && releasedProps?.props?.held === false && ua875?.seatsLeft === 0, "the picker is revised in place: holds gone, UA 875 sold out", () => JSON.stringify(releasedProps));
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
    const seat = latestSeats().props.rows.flatMap((r) => r.seats).filter((s) => !s.taken).at(-1);
    const pick = await sse("/hai/interact", { conversationId: id, handle: latestSeats().handle, action: "pick", value: seat?.id });
    const care = surface(pick, "care_options");
    check(care.ui?.mode === "elicit" && care.props?.choices.length === 3, `seat ${seat?.id} picked; NH 7 leaves tomorrow, so the guide asks about tonight`, () => JSON.stringify(pick.filter((e) => e.type === "error" || e.type === "ui_open")));

    // 6 · where to spend tonight, then the boarding pass for exactly what was clicked
    const hotel = await sse("/hai/interact", { conversationId: id, handle: care.ui?.handle, action: "choose", value: "hotel" });
    const pass = surface(hotel, "boarding_pass");
    check(
      pass.ui?.mode === "display" && pass.props?.flight === "NH 7" && pass.props.seat === seat?.id && /Hotel voucher/.test(pass.props.care ?? "") &&
        pass.props.gate === "G95" && pass.props.boards === "10:20",
      `the boarding pass: NH 7, seat ${seat?.id}, gate G95, boarding 10:20, and the hotel`,
      () => JSON.stringify(pass.props),
    );
    check(lastStatus(hotel) === "idle" && /You're booked/.test(said(hotel)), `the guide wraps up: “${said(hotel).slice(0, 60)}…”`, () => said(hotel));
    const context = hotel.find((e) => e.type === "context");
    // the whole conversation: every digest, click and revision the model was told of, against every component's props
    check(context && context.uiTokens > 2 * context.modelTokens, `the browser holds ~${context?.uiTokens} tokens of components; the model's whole context is ~${context?.modelTokens}`, () => JSON.stringify({ model: context?.modelTokens, ui: context?.uiTokens }));
    const confirmed = await stream.until((e) => e.type === "notice" && e.name === "seat_confirmed", 6_000);
    check(confirmed?.handle === pass.ui?.handle && confirmed.payload.seat === seat?.id, "the airline confirms the seat a moment later, beside the pass", () => JSON.stringify(confirmed));

    // 7 · the gate moves: the pass is revised, and the guide speaks up without being asked
    const gateMark = stream.events.length;
    const gate = await ops("gate", id);
    check(gate.status === 200 && /gate G99/.test(gate.message), `ops gate: “${gate.message}”`, () => JSON.stringify(gate));
    const moved = await stream.until((e) => e.type === "ui_props" && e.props?.gate === "G99", 8_000, gateMark);
    check(moved, "the boarding pass is revised in place to gate G99", "the pass was not revised");
    await stream.until((e) => e.type === "released", 8_000, gateMark);
    const headsUp = said(stream.events.slice(gateMark));
    check(/^Heads up: NH 7 moved from gate G95 to gate G99\. Boarding is still 10:20\. And the airline confirmed seat/.test(headsUp), `the guide speaks up: “${headsUp.slice(0, 64)}…”`, `the guide said: ${headsUp}`);

    stream.close();

    // 7b · the gate moves while a question on the flight home waits: no turn
    //      can start, so the news rides with the next click, and the guide
    //      says it before answering the click
    {
      const search = surface(await sse("/hai/chat", { conversationId: id, message: "book my flight home on Sunday" }), "flight_search");
      const moved = await ops("gate", id);
      const go = await sse("/hai/interact", { conversationId: id, handle: search.ui?.handle, action: "search", value: { from: "TYO", date: "Sun" } });
      check(
        moved.status === 200 && /^Heads up: NH 7 moved from gate G99 to gate G103\. Boarding is still 10:20\. Here are the flights home on Sunday/.test(said(go)) &&
          surface(go, "flight_results").ui?.mode === "elicit",
        `a gate change that rode in with a booking click is told first: “${said(go).slice(0, 70)}…”`,
        () => `${moved.message} · ${said(go)}`,
      );
    }

    // 8b · a second conversation: a release after the traveller chose changes
    //      nothing, and a seat map shown again keeps the seats others took
    {
      const begin = await sse("/hai/start", {});
      const id2 = begin.find((e) => e.type === "hello")?.conversationId;
      const watch2 = watch(id2);
      await ops("cancel", id2);
      const first = await watch2.until((e) => e.type === "ui_open" && e.component === "rebooking_options");
      await watch2.until((e) => e.type === "status" && e.status === "awaiting");
      const chose = await sse("/hai/interact", { conversationId: id2, handle: first?.handle, action: "choose", value: "o05" });
      const map = surface(chose, "seat_map");
      const late = await ops("release", id2);
      check(late.status === 409 && /already chosen/.test(late.message), `a release after the traveller chose is refused: “${late.message}”`, () => JSON.stringify(late));
      const gone = await watch2.until((e) => e.type === "ui_props" && e.handle !== map.ui?.handle && e.props?.flight === "NH 7");
      const takenNow = gone?.props?.rows.flatMap((r) => r.seats).filter((s) => s.taken).map((s) => s.id) ?? [];
      // something the scripted guide doesn't understand closes the seat map too, and it opens the map again
      const thanks = await sse("/hai/chat", { conversationId: id2, message: "thanks" });
      const mapAgain = surface(thanks, "seat_map");
      check(
        mapAgain.ui?.mode === "elicit" && mapAgain.props?.flight === "NH 7" && lastStatus(thanks) === "awaiting" && /Here's where you were/.test(said(thanks)),
        "a message the guide doesn't understand closes the seat map, and the guide opens it again",
        () => `${said(thanks)} · ${JSON.stringify(mapAgain.ui)}`,
      );
      const again = surface(await sse("/hai/chat", { conversationId: id2, message: "show me all the options" }), "rebooking_options");
      const nh7 = again.props?.options.find((o) => o.id === "o05");
      check(again.props?.held === true && nh7?.seatsLeft === 5 && again.props.options.length === 14, "…and the options shown again are as before it: still held, NH 7 still 5 seats", () => JSON.stringify({ held: again.props?.held, nh7 }));
      const reopened = surface(await sse("/hai/interact", { conversationId: id2, handle: again.ui?.handle, action: "choose", value: "o05" }), "seat_map");
      const takenAfter = new Set(reopened.props?.rows.flatMap((r) => r.seats).filter((s) => s.taken).map((s) => s.id));
      check(
        takenNow.length > 0 && takenNow.every((s) => takenAfter.has(s)),
        `NH 7's seat map, shown again, keeps the seats other passengers took (${takenNow.length - (map.props?.rows.flatMap((r) => r.seats).filter((s) => s.taken).length ?? 0)} since it first opened)`,
        () => `taken before: ${takenNow.join(" ")}; after: ${[...takenAfter].join(" ")}`,
      );
      watch2.close();
    }

    // 8b2 · the traveller types before the wake turn starts: the cancellation
    //       rides with their message instead, and the guide still opens the options
    {
      const begin = await sse("/hai/start", {});
      const id3 = begin.find((e) => e.type === "hello")?.conversationId;
      // no events stream is open, so no wake turn can start before the message
      await ops("cancel", id3);
      const typed = await sse("/hai/chat", { conversationId: id3, message: "hello?" });
      const picker = surface(typed, "rebooking_options");
      check(
        /^I'm sorry: your 18:05 UA 837 to Tokyo was cancelled/.test(said(typed)) && picker.ui?.mode === "elicit" && picker.props?.options.length === 14,
        "a cancellation that rides with a typed message still gets the apology and the options",
        () => `${said(typed)} · ${JSON.stringify(picker.ui)}`,
      );
    }

    // 8c · a seat can only be booked on the option the traveller chose. Run
    //      here, in this process, on a conversation of its own: o05 chosen.
    {
      const { tripShown, optionChosen } = await import("../src/server/airline.ts");
      const { optionById, seatRows } = await import("../src/server/data.ts");
      const { showSeatMap } = await import("../src/server/tools.ts");
      const { seatMapServer } = await import("../src/server/surfaces.ts");
      tripShown("local", "ui_01");
      optionChosen("local", optionById("o05"));
      const stub = { conversationId: "local", text: (model) => ({ model }), render: async () => ({ model: "a seat map was shown" }) };
      const other = await showSeatMap.run({ optionId: "o07" }, stub);
      check(/chose o05 \(NH 7\), not o07/.test(other.model), "show_seat_map refuses an option the traveller didn't choose", () => other.model);
      const pick = (optionId, flight, seat) => {
        const rows = seatRows(flight).map((r) => ({ ...r, seats: r.seats.map((s) => ({ ...s, taken: false })) }));
        try {
          return seatMapServer.impl.actions.pick(seat, { props: { optionId, flight, airline: "", rows }, conversationId: "local", handle: "ui_02" });
        } catch (err) {
          return `refused: ${err.message}`;
        }
      };
      const elsewhere = pick("o07", "JL 1", "10B");
      const chosenOne = pick("o05", "NH 7", "10B");
      check(
        /^refused: JL 1 isn't the flight you chose/.test(elsewhere) && /^Picked seat 10B on NH 7/.test(chosenOne),
        "…and a seat on another option's map is refused, not taken and then not booked; on the chosen one's, it's picked",
        () => `${elsewhere} · ${chosenOne}`,
      );
    }

    // 11 · the flight home, from the trip card's button: the search is filled
    //      in from the trip, and the day is left to choose
    {
      const begin = await sse("/hai/start", {});
      const id4 = begin.find((e) => e.type === "hello")?.conversationId;
      const card = surface(begin, "trip_card");
      const watch4 = watch(id4);
      const click = await sse("/hai/interact", { conversationId: id4, handle: card.ui?.handle, action: "book_home", value: "home" });
      const search = surface(click, "flight_search");
      check(
        search.ui?.mode === "elicit" && search.props?.passenger === "Alex Morgan" && search.props.from === "TYO" && search.props.to.code === "SFO" &&
          search.props.date === null && search.props.sources.date === null && search.props.sources.passenger === "your trip",
        "Book my flight home on the trip card tells the guide, which shows the search filled in from the trip, the day left to choose",
        () => JSON.stringify(search),
      );
      check(/^Which day would you like to fly home\?/.test(said(click)), `the guide asks only for what it doesn't know: “${said(click)}”`, () => said(click));
      const tuesday = await sse("/hai/interact", { conversationId: id4, handle: search.ui?.handle, action: "search", value: { from: "TYO", date: "Tue" } });
      check(/invalid action payload/.test(refusal(tuesday)), "a day the search doesn't offer is refused by the contract", () => refusal(tuesday));
      const twice = await sse("/hai/interact", { conversationId: id4, handle: card.ui?.handle, action: "book_home", value: "home" });
      check(/a question is waiting to be answered first/.test(refusal(twice)), "the trip card's button is refused while the search waits", () => refusal(twice));

      const go = await sse("/hai/interact", { conversationId: id4, handle: search.ui?.handle, action: "search", value: { from: "TYO", date: "Sun" } });
      const results = surface(go, "flight_results");
      const departs = results.props?.flights.map((f) => f.depart) ?? [];
      check(
        results.ui?.mode === "elicit" && results.props?.flights.length === 10 && results.props.date === "Sun" && departs.every((d, i) => i === 0 || departs[i - 1] <= d),
        "searching shows the 10 flights home on Sunday, the earliest to leave first, waiting for a pick",
        () => JSON.stringify(results.props?.flights.map((f) => `${f.id} ${f.depart}`)),
      );
      const flightsDigest = digestOf(go, /^Flights home on/);
      check(
        /Cheapest: ZG 26 .*from \$590.*Nonstop: 5\. From Narita: 5\. From Haneda: 5\./.test(flightsDigest),
        `the model gets a digest (~${Math.ceil(flightsDigest.length / 4)} tok) of flights that stay in the browser (~${Math.ceil(JSON.stringify(results.props).length / 4)} tok)`,
        () => flightsDigest,
      );

      // a typed question, answered from the stored flights and capped, then shown as a picker
      const nonstop = await sse("/hai/chat", { conversationId: id4, message: "which are nonstop?" });
      const answer = nonstop.find((e) => e.type === "block_update" && /^5 of 10 match/.test(e.result ?? ""));
      const nonstops = surface(nonstop, "flight_results");
      check(
        answer && nonstops.ui?.mode === "elicit" && nonstops.props?.flights.length === 5 && nonstops.props.filter === "nonstops",
        "“which are nonstop?” is answered from the stored flights, “5 of 10 match”, and the 5 are shown as a new picker",
        () => `${answer?.result?.split("\n")[0]} · ${JSON.stringify(nonstops.props?.flights.map((f) => f.id))}`,
      );
      const cheapest = await sse("/hai/chat", { conversationId: id4, message: "which is cheapest?" });
      const cheap = surface(cheapest, "flight_results");
      check(
        /^The cheapest is ZG 26 /.test(said(cheapest).replace(/^Checking which costs least\./, "")) && cheap.props?.filter === "nonstops",
        `“which is cheapest?” asks the nonstops on screen: “${said(cheapest).replace(/^Checking which costs least\./, "").slice(0, 50)}…”`,
        () => said(cheapest),
      );

      // naming the flight home in a question doesn't start a new search
      const phrased = await sse("/hai/chat", { conversationId: id4, message: "which flight home is cheapest?" });
      const picker = surface(phrased, "flight_results");
      check(
        !opened(phrased, "flight_search").length && /Checking which costs least\..*The cheapest is ZG 26/.test(said(phrased)) && picker.ui?.mode === "elicit",
        "“which flight home is cheapest?” is a question about the flights on screen, not a new search",
        () => said(phrased),
      );

      // the flight, then the fares; Basic assigns the seat at check-in, so there's no seat map
      const flight = await sse("/hai/interact", { conversationId: id4, handle: picker.ui?.handle, action: "choose", value: "r01" });
      const fares = surface(flight, "fare_options");
      check(
        fares.ui?.mode === "elicit" && fares.props?.flight === "UA 838" && fares.props.fares.map((f) => `${f.id} ${f.price}`).join(", ") === "basic 960, standard 1100, flex 1380",
        "choosing UA 838 shows its three fares: Basic $960, Standard $1,100, Flex $1,380",
        () => JSON.stringify(fares.props?.fares.map((f) => [f.id, f.price])),
      );
      const basic = await sse("/hai/interact", { conversationId: id4, handle: fares.ui?.handle, action: "choose", value: "basic" });
      const review = surface(basic, "booking_review");
      check(
        !opened(basic, "seat_map").length && review.ui?.mode === "elicit" && review.props?.seat === null && review.props.price.total === 1028 && /nothing is charged/.test(review.props.payment),
        "Basic skips the seat map: the review waits, seat at check-in, $1,028 with taxes, nothing charged",
        () => JSON.stringify(review.props),
      );

      // the airline raises the fare while the review waits: revised in place, and the old total is refused
      const mark = watch4.events.length;
      const raise = await ops("fare", id4);
      check(raise.status === 200 && /\$1,088/.test(raise.message), `ops fare: “${raise.message}”`, () => JSON.stringify(raise));
      const raised = await watch4.until((e) => e.type === "ui_open" && e.component === "booking_review" && e.replaces, 8_000, mark);
      const raisedProps = await watch4.until((e) => e.type === "ui_props" && e.handle === raised?.handle, 8_000, mark);
      check(
        raised?.replaces === review.ui?.handle && raisedProps?.props?.price.total === 1088 && raisedProps.props.previousTotal === 1028,
        "the review is revised in place: $1,088 now, and it says it was $1,028",
        () => JSON.stringify(raisedProps?.props?.price),
      );
      const stale = await sse("/hai/interact", { conversationId: id4, handle: raised?.handle, action: "confirm", value: { total: 1028 } });
      check(/the total is \$1,088 now, not \$1,028/.test(refusal(stale)), "a Confirm carrying the old total is refused, not charged", () => refusal(stale));
      const old = await sse("/hai/interact", { conversationId: id4, handle: review.ui?.handle, action: "confirm", value: { total: 1088 } });
      check(/superseded by/.test(refusal(old)), "…and a click on the review before the raise is refused as superseded", () => refusal(old));

      const confirm = await sse("/hai/interact", { conversationId: id4, handle: raised?.handle, action: "confirm", value: { total: 1088 } });
      const ticket = surface(confirm, "booking_confirmed");
      check(
        ticket.ui?.mode === "display" && ticket.props?.total === 1088 && ticket.props.fare === "Basic" && ticket.props.seat === null && ticket.props.legs[0]?.flight === "UA 838",
        "confirming at $1,088 books exactly that: the e-ticket, UA 838, Basic, $1,088",
        () => JSON.stringify(ticket.props),
      );
      check(
        /The airline raised the Basic fare/.test(JSON.stringify(confirm.find((e) => e.type === "context")?.messages ?? "")) && /^Booked at the new total, \$1,088/.test(said(confirm)),
        `the model hears of the raise with the click: “${said(confirm).slice(0, 60)}…”`,
        () => said(confirm),
      );
      const issued = await watch4.until((e) => e.type === "notice" && e.name === "ticket_issued", 6_000);
      check(issued?.handle === ticket.ui?.handle && /^016-\d{10}$/.test(issued.payload.ticket), "the airline issues the ticket a moment later, beside the e-ticket", () => JSON.stringify(issued));
      const home = await watch4.until((e) => e.type === "ui_props" && e.props?.home, 6_000);
      check(home?.props?.home?.flight === "UA 838" && home.props.home.reference === ticket.props?.reference, "the trip card is revised to show the flight home", () => JSON.stringify(home?.props?.home));
      const late = await ops("fare", id4);
      check(late.status === 409 && /already confirmed/.test(late.message), `a raise after the traveller confirmed is refused: “${late.message}”`, () => JSON.stringify(late));
      const latestCard = watch4.events.filter((e) => e.type === "ui_open" && e.component === "trip_card").at(-1)?.handle;
      const booked = await sse("/hai/interact", { conversationId: id4, handle: latestCard, action: "book_home", value: "home" });
      check(/the flight home is already booked: UA 838/.test(refusal(booked)), "the trip card's button is refused once the flight home is booked", () => refusal(booked));
      const after = await sse("/hai/chat", { conversationId: id4, message: "show all flights" });
      check(
        !opened(after, "flight_results").length && /already booked: UA 838, booking /.test(said(after)),
        "once ticketed, the flights home aren't shown again: the guide says it's booked",
        () => said(after),
      );
      watch4.close();
    }

    // 11b · the flight home, asked for in words, with a seat: the day and the
    //       airport come from the message, and a seat can be changed at the review
    {
      const begin = await sse("/hai/start", {});
      const id5 = begin.find((e) => e.type === "hello")?.conversationId;
      const asked = await sse("/hai/chat", { conversationId: id5, message: "Book my flight home on Friday from Haneda" });
      const search = surface(asked, "flight_search");
      check(
        search.props?.date === "Fri" && search.props.from === "HND" && search.props.sources.date === "your message" && search.props.sources.from === "your message",
        "“Book my flight home on Friday from Haneda” fills in the day and the airport from the message",
        () => JSON.stringify(search.props),
      );
      // something the guide doesn't understand closes the search, and it shows it again as it was
      const hello = surface(await sse("/hai/chat", { conversationId: id5, message: "hello" }), "flight_search");
      check(
        hello.ui?.mode === "elicit" && hello.props?.date === "Fri" && hello.props.from === "HND",
        "a message the guide doesn't understand closes the search, and it's shown again with its day and its airport",
        () => JSON.stringify(hello.props),
      );
      const go = await sse("/hai/interact", { conversationId: id5, handle: hello.ui?.handle, action: "search", value: { from: "HND", date: "Fri" } });
      const results = surface(go, "flight_results");
      check(results.props?.flights.length === 5 && results.props.flights.every((f) => f.from === "HND"), "Haneda on Friday: 5 flights, all from HND", () => JSON.stringify(results.props?.flights.map((f) => f.id)));
      const fares = surface(await sse("/hai/interact", { conversationId: id5, handle: results.ui?.handle, action: "choose", value: "r03" }), "fare_options");
      const standard = await sse("/hai/interact", { conversationId: id5, handle: fares.ui?.handle, action: "choose", value: "standard" });
      const map = surface(standard, "seat_map");
      check(map.ui?.mode === "elicit" && map.props?.purpose === "book" && map.props.flight === "JL 2", "Standard lets the traveller choose: JL 2's seat map, for the flight home", () => JSON.stringify(map.ui));
      const free = () => map.props.rows.flatMap((r) => r.seats).filter((s) => !s.taken);
      const first = free().at(-1);
      const review = surface(await sse("/hai/interact", { conversationId: id5, handle: map.ui?.handle, action: "pick", value: first?.id }), "booking_review");
      check(review.props?.seat === first?.id && review.props.fare.name === "Standard", `seat ${first?.id} picked: the review shows it`, () => JSON.stringify(review.props));
      const change = await sse("/hai/interact", { conversationId: id5, handle: review.ui?.handle, action: "change", value: "seat" });
      const again = surface(change, "seat_map");
      const seatsNow = again.props?.rows.flatMap((r) => r.seats).filter((s) => !s.taken) ?? [];
      const second = seatsNow.find((s) => s.id !== first?.id);
      const review2 = surface(await sse("/hai/interact", { conversationId: id5, handle: again.ui?.handle, action: "pick", value: second?.id }), "booking_review");
      check(again.props?.purpose === "book" && review2.props?.seat === second?.id, `Change seat opens the map again, and the review shows seat ${second?.id}`, () => JSON.stringify(review2.props));
      const ticket = surface(await sse("/hai/interact", { conversationId: id5, handle: review2.ui?.handle, action: "confirm", value: { total: review2.props?.price.total } }), "booking_confirmed");
      check(
        ticket.props?.seat === second?.id && ticket.props.bags === "1 checked bag" && ticket.props.total === review2.props?.price.total,
        `the e-ticket books seat ${second?.id}, 1 checked bag, $${review2.props?.price.total}`,
        () => JSON.stringify(ticket.props),
      );
    }

    // 11d · a raised Basic fare is the price everywhere after: the flights
    //       shown again, and the fares, which count it once
    {
      const begin = await sse("/hai/start", {});
      const id6 = begin.find((e) => e.type === "hello")?.conversationId;
      const search = surface(await sse("/hai/chat", { conversationId: id6, message: "book my flight home on Sunday" }), "flight_search");
      const results = surface(await sse("/hai/interact", { conversationId: id6, handle: search.ui?.handle, action: "search", value: { from: "TYO", date: "Sun" } }), "flight_results");
      const fares = surface(await sse("/hai/interact", { conversationId: id6, handle: results.ui?.handle, action: "choose", value: "r01" }), "fare_options");
      const review = surface(await sse("/hai/interact", { conversationId: id6, handle: fares.ui?.handle, action: "choose", value: "basic" }), "booking_review");
      await ops("fare", id6);
      const revised = await (async () => {
        for (let i = 0; i < 40; i++) {
          const r = await sse("/hai/interact", { conversationId: id6, handle: review.ui?.handle, action: "change", value: "flight" });
          const latest = refusal(r).match(/superseded by (ui_\d+)/)?.[1];
          if (latest) return latest;
          await new Promise((r) => setTimeout(r, 100));
        }
      })();
      const change = await sse("/hai/interact", { conversationId: id6, handle: revised, action: "change", value: "flight" });
      const again = surface(change, "flight_results");
      const r01 = again.props?.flights.find((f) => f.id === "r01");
      check(r01?.price === 1020, "after the raise, Change flight shows UA 838 at its new Basic fare, $1,020", () => JSON.stringify(r01));
      const chose = await sse("/hai/interact", { conversationId: id6, handle: again.ui?.handle, action: "choose", value: "r01" });
      const fares2 = surface(chose, "fare_options");
      // the second time UA 838 is chosen, after the raise
      const heard = [...JSON.stringify(chose.find((e) => e.type === "context")?.messages ?? "").matchAll(/Chose flight r01: [^"]*/g)].at(-1)?.[0] ?? "";
      check(
        /from \$1,020/.test(heard) &&
          fares2.props?.fares.map((f) => `${f.id} ${f.price}`).join(", ") === "basic 1020, standard 1100, flex 1380",
        "…the model reads $1,020 too, and its fares count the raise once, on Basic only: $1,020, $1,100, $1,380",
        () => `${heard} · ${JSON.stringify(fares2.props?.fares.map((f) => [f.id, f.price]))}`,
      );
    }

    // 11f · the flight is cancelled while the flight home is being booked. No
    //       events stream is open, so no wake turn: the news rides with the
    //       next click, and that click still gets its answer.
    {
      const bookTo = async (id, until) => {
        const search = surface(await sse("/hai/chat", { conversationId: id, message: "book my flight home on Sunday" }), "flight_search");
        const results = surface(await sse("/hai/interact", { conversationId: id, handle: search.ui?.handle, action: "search", value: { from: "TYO", date: "Sun" } }), "flight_results");
        const fares = surface(await sse("/hai/interact", { conversationId: id, handle: results.ui?.handle, action: "choose", value: "r01" }), "fare_options");
        if (until === "fares") return fares;
        return surface(await sse("/hai/interact", { conversationId: id, handle: fares.ui?.handle, action: "choose", value: "basic" }), "booking_review");
      };

      // with Confirm: the ticket is issued, and the options to Tokyo open in the same reply
      const id7 = (await sse("/hai/start", {})).find((e) => e.type === "hello")?.conversationId;
      const review = await bookTo(id7, "review");
      await ops("cancel", id7);
      const confirm = await sse("/hai/interact", { conversationId: id7, handle: review.ui?.handle, action: "confirm", value: { total: 1028 } });
      const ticket = surface(confirm, "booking_confirmed");
      const options = surface(confirm, "rebooking_options");
      check(
        ticket.props?.total === 1028 && options.ui?.mode === "elicit" && /^I'm sorry: .*First, your flight home: Booked\./.test(said(confirm)),
        "cancelled while the review waits: Confirm still issues the ticket, and the options to Tokyo open with it",
        () => `${said(confirm)} · ${JSON.stringify({ ticket: ticket.props?.total, options: options.ui?.mode })}`,
      );
      const choose = await sse("/hai/interact", { conversationId: id7, handle: options.ui?.handle, action: "choose", value: "o05" });
      check(surface(choose, "seat_map").props?.flight === "NH 7", "…and choosing an option carries on to its seat map, with the ticket's result held until then", () => said(choose));

      // with an earlier step: the booking is finished first, and the options follow the ticket
      const id8 = (await sse("/hai/start", {})).find((e) => e.type === "hello")?.conversationId;
      const fares = await bookTo(id8, "fares");
      await ops("cancel", id8);
      const basic = await sse("/hai/interact", { conversationId: id8, handle: fares.ui?.handle, action: "choose", value: "basic" });
      const review2 = surface(basic, "booking_review");
      check(
        review2.ui?.mode === "elicit" && /^I'm sorry: .*Let's finish booking your flight home first/.test(said(basic)) && !opened(basic, "rebooking_options").length,
        "cancelled while the fares wait: the guide says so, and finishes the flight home first",
        () => said(basic),
      );
      const done = await sse("/hai/interact", { conversationId: id8, handle: review2.ui?.handle, action: "confirm", value: { total: 1028 } });
      check(
        opened(done, "booking_confirmed").length === 1 && surface(done, "rebooking_options").ui?.mode === "elicit",
        "…then, with the ticket issued, the options to Tokyo open",
        () => said(done),
      );
    }

    // 11e · the trip card's revisions take turns: a cancellation and the
    //       flight home, overlapping, both stay on the card. In this process,
    //       with an airline whose revisions are slow.
    {
      const airline = await import("../src/server/airline.ts");
      const saved = [];
      airline.connectAirline(
        async () => ({ seq: 1 }),
        async (_id, _surface, handle, props) => {
          await new Promise((r) => setTimeout(r, 2_000));
          saved.push(props);
          return { handle: `${handle}+`, model: "" };
        },
      );
      airline.tripShown("overlap", "ui_01");
      const cancelling = airline.cancelFlight("overlap");
      airline.ticketShown("overlap", "ui_09", { passenger: "Alex Morgan", reference: "ABC234", legs: [{ flight: "UA 838", from: "NRT", to: "SFO" }], depart: "Sun 16:55", arrive: "Sun 10:50", fare: "Basic", seat: null, bags: "carry-on only", total: 1028 });
      await cancelling;
      await new Promise((r) => setTimeout(r, 3_000)); // the ticket's revision starts at 1.5 s, and takes 2
      const last = saved.at(-1);
      check(
        saved.length === 2 && last?.status === "cancelled" && last.home?.reference === "ABC234",
        "a cancellation and the flight home, overlapping, both stay on the trip card",
        () => JSON.stringify(saved.map((t) => ({ status: t.status, home: t.home }))),
      );

      // two raises at once, against the same slow airline: one is refused, so the rise counts once
      const { flightsHome } = await import("../src/server/data.ts");
      airline.tripShown("raises", "ui_01");
      airline.searched("raises", { from: "TYO", date: "Sun" });
      airline.homeFlightChosen("raises", flightsHome("Sun").find((f) => f.id === "r01"));
      airline.fareChosen("raises", { id: "basic", name: "Basic", price: 960, seatChoice: false, includes: [] });
      const review = {
        passenger: "Alex Morgan", flightId: "r01", airline: "United", legs: [{ flight: "UA 838", from: "NRT", to: "SFO" }], depart: "Sun 16:55",
        arrive: "Sun 10:50", fare: { id: "basic", name: "Basic", seatChoice: false }, seat: null, price: { fare: 960, taxes: 68, total: 1028 },
        previousTotal: null, payment: "",
      };
      airline.reviewShown("raises", "ui_05", review);
      const both = await Promise.allSettled([airline.raiseFare("raises"), airline.raiseFare("raises")]);
      const stored = airline.booking("raises");
      check(
        both.filter((r) => r.status === "fulfilled").length === 1 && /being raised already/.test(both.find((r) => r.status === "rejected")?.reason?.message) &&
          stored.review.props.price.total === 1088 && stored.fare.price === 1020 && stored.rises.get("r01:basic") === 60,
        "two raises at once: one is refused, and the review, the fare and the rise all say $60 more, once",
        () => JSON.stringify({ both: both.map((r) => r.status === "fulfilled" ? r.value : r.reason.message), total: stored?.review?.props.price.total, fare: stored?.fare?.price, rise: stored?.rises.get("r01:basic") }),
      );
    }

    // 11c · each step of the flight home books only what the traveller clicked.
    //       Run in this process, on a conversation of its own.
    {
      const airline = await import("../src/server/airline.ts");
      const { flightsHome } = await import("../src/server/data.ts");
      const { issueTicket, reviewBooking, showFares, showHomeSeats } = await import("../src/server/tools.ts");
      const { fareOptionsServer } = await import("../src/server/surfaces.ts");
      const stub = { conversationId: "home", text: (model) => ({ model }), render: async () => ({ model: "shown" }) };
      airline.tripShown("home", "ui_01");
      const before = await issueTicket.run({}, stub);
      airline.searched("home", { from: "TYO", date: "Sun" });
      const noFlight = await showFares.run({ flightId: "r01" }, stub);
      const [r01, r02] = flightsHome("Sun").filter((f) => f.id === "r01" || f.id === "r02");
      airline.homeFlightChosen("home", r01);
      const otherFlight = await showFares.run({ flightId: "r02" }, stub);
      const noFare = await reviewBooking.run({}, stub);
      const fareProps = { flightId: "r02", flight: r02.flights[0], airline: r02.airline, date: "Sun", fares: [{ id: "basic", name: "Basic", price: 1, seatChoice: false, includes: [] }] };
      let wrongFare;
      try {
        wrongFare = fareOptionsServer.impl.actions.choose("basic", { props: fareProps, conversationId: "home", handle: "ui_02" });
      } catch (err) {
        wrongFare = `refused: ${err.message}`;
      }
      airline.fareChosen("home", { id: "basic", name: "Basic", price: 960, seatChoice: false, includes: [] });
      const basicSeats = await showHomeSeats.run({ flightId: "r01" }, stub);
      const unconfirmed = await issueTicket.run({}, stub);
      check(
        /hasn't confirmed a booking yet/.test(before.model) && /hasn't chosen a flight home yet/.test(noFlight.model) && /chose r01 \(UA 838\), not r02/.test(otherFlight.model) &&
          /hasn't chosen a fare yet/.test(noFare.model) && /^refused: NH 8 isn't the flight you chose/.test(wrongFare) && /assigns the seat at check-in/.test(basicSeats.model) &&
          /hasn't confirmed a booking yet/.test(unconfirmed.model),
        "no step of the flight home runs ahead of the clicks: fares, a fare, seats, the review and the ticket each refuse",
        () => [before.model, noFlight.model, otherFlight.model, noFare.model, wrongFare, basicSeats.model, unconfirmed.model].join(" · "),
      );
    }

    // 9 · the boarding pass books only what the traveller clicked
    const { issueBoardingPass } = await import("../src/server/tools.ts");
    const early = await issueBoardingPass.run({}, { conversationId: "nobody", text: (model) => ({ model }) });
    check(/hasn't chosen an option yet/.test(early.model), "issue_boarding_pass refuses before the traveller has chosen", () => early.model);

    // 10 · each surface and notice has a component in the browser registry
    const registry = await fetch(`${BASE}/components.js`).then((r) => r.text());
    for (const component of [
      "trip_card", "rebooking_options", "seat_map", "care_options", "boarding_pass", "flight_cancelled", "seat_confirmed",
      "flight_search", "flight_results", "fare_options", "booking_review", "booking_confirmed", "ticket_issued",
    ]) {
      check(new RegExp(`\\b${component}\\s*:`).test(registry), `${component} is registered in components.js`, `${component} missing from components.js`);
    }
  }
} finally {
  child.kill("SIGKILL");
}

console.log(failures ? `\n${failures} check(s) failed\n` : "\nsmoke: all checks passed\n");
process.exit(failures ? 1 : 0);
