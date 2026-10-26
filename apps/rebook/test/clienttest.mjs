/**
 * The browser half against a real React and a DOM (jsdom). Every surface and
 * notice mounts from the props the server really sends, each click sends only
 * the action its contract declares with the value on screen, a refused or
 * failed click leaves the question live, a frozen surface says what was
 * chosen, a revision keeps the traveller's filter and keyboard, and payload
 * text stays text, never HTML. Then the Airline ops bar posts its routes and
 * runs its countdown.
 *
 * The components are TSX, so Vite loads them, as it does in the browser; the
 * fixtures come from the server's own data, so they're the demo's own trip.
 *
 *   npm run clienttest
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── a DOM, and the browser globals React, Radix and the components reach for
const { window } = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true, url: "http://localhost/" });
globalThis.window = window;
for (const name of Object.getOwnPropertyNames(window)) {
  if (/^(?:document|Node|getComputedStyle|requestAnimationFrame|cancelAnimationFrame)$|^(?:HTML|SVG)?\w*Element$|Event$/.test(name) && !(name in globalThis)) {
    globalThis[name] = window[name];
  }
}
window.matchMedia = globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
window.ResizeObserver = globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
globalThis.CSS ??= { escape: (s) => String(s).replace(/[^\w-]/g, (c) => `\\${c}`) };
// a click whose request fails is logged, as in the browser's console
const logged = [];
console.error = (...args) => void logged.push(args.join(" "));
// tells React that updates here are flushed through act()
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let failures = 0;
const check = (label, ok) => {
  console.log(`  ${ok ? "\x1b[32m✓" : "\x1b[31m✗"}\x1b[0m ${label}`);
  if (!ok) failures++;
};

const vite = await createServer({ root: APP, appType: "custom", logLevel: "error", server: { middlewareMode: true, hmr: false } });
try {
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { registry, notices } = await vite.ssrLoadModule("/src/client/components.tsx");
  const { OpsBar } = await vite.ssrLoadModule("/src/client/ops.tsx");
  const { TRIP, OPTIONS, CARE, PAYMENT, HOME, seatRows, flightsHome, faresFor } = await import(path.join(APP, "src/server/data.ts"));

  /** Mount a registry entry. Each send waits until `release()`, as a request in flight does. */
  async function mount(name, props, { mode = "elicit", state = "live", selection } = {}) {
    const el = document.createElement("div");
    document.body.append(el);
    const sent = [];
    let pending = [];
    const send = (action, value) => {
      sent.push([action, value]);
      return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    };
    let instance;
    await act(async () => {
      instance = registry[name].mount(el, props, { handle: "ui_01", mode, state, selection, send });
    });
    return {
      el,
      sent,
      freeze: (picked) => act(async () => instance.freeze(picked)),
      update: (next) => act(async () => instance.update(next)),
      unmount: () => act(async () => instance.unmount()),
      // the server's answer comes back: the surface stays live unless frozen
      release: () =>
        act(async () => {
          for (const { resolve } of pending) resolve();
          pending = [];
        }),
      // or it never arrives: the request failed on its way
      fail: () =>
        act(async () => {
          for (const { reject } of pending) reject(new TypeError("Failed to fetch"));
          pending = [];
        }),
    };
  }
  const fire = (node, event) => act(async () => void node.dispatchEvent(event));
  const click = (node) => fire(node, new window.MouseEvent("click", { bubbles: true }));
  const focus = (node) => act(async () => node.focus());
  const buttons = (el) => [...el.querySelectorAll("button")];
  const button = (el, text) => buttons(el).find((b) => b.textContent.trim() === text);
  const keyed = (el, key) => el.querySelector(`[data-key="${key}"]`);
  const text = (el) => el.textContent.replace(/\s+/g, " ");
  const sentIs = (s, expected) => JSON.stringify(s.sent) === JSON.stringify(expected);

  // ── the trip card
  console.log("\ntrip_card");
  {
    const t = await mount("trip_card", TRIP, { mode: "display" });
    check("it shows the trip, on time, with no flight home", text(t.el).includes("SFO") && text(t.el).includes("On time") && text(t.el).includes("Not booked yet"));
    await click(button(t.el, "Book my flight home"));
    check("Book my flight home sends book_home: home", sentIs(t, [["book_home", "home"]]));
    check("while it's on its way, the button waits", button(t.el, "Book my flight home").disabled);
    await t.release();
    check("answered, the button stays until the card is revised", !button(t.el, "Book my flight home").disabled);
    await t.update({ ...TRIP, status: "cancelled", reason: "a crew shortage" });
    check("revised by the airline, it says cancelled, and why", text(t.el).includes("Cancelled") && text(t.el).includes("Cancelled because of a crew shortage."));
    await t.update({ ...TRIP, status: "cancelled", reason: "a crew shortage", home: { flight: "UA 838", depart: "Sun 16:55", reference: "HM7K2P" } });
    check("revised once the flight home is booked, the button goes", text(t.el).includes("UA 838 · Sun 16:55 · booking HM7K2P") && !button(t.el, "Book my flight home"));
  }

  // ── the options
  console.log("\nrebooking_options");
  const options = OPTIONS.map((o, i) => (i === 1 ? { ...o, seatsLeft: 0 } : o));
  const optionsProps = { cancelled: "UA 837", options, total: options.length, filter: null, held: true };
  {
    const o = await mount("rebooking_options", optionsProps);
    const rows = () => o.el.querySelectorAll("ol > li");
    check(`it lists all ${options.length}, seats held`, rows().length === options.length && text(o.el).includes(`${options.length} ways to get there`) && text(o.el).includes("Seats held · 5 min"));
    check("a sold-out option is a row, not a button", !keyed(o.el, `option:${options[1].id}`) && text(o.el).includes("Sold out"));
    await click(o.el.querySelector('[data-key="filter:nonstop"]'));
    check("Nonstop filters the list here, and sends nothing", rows().length === options.filter((x) => !x.via).length && o.sent.length === 0);
    await click(o.el.querySelector('[data-key="filter:nonstop"]'));
    check("pressed again, the filter stays on", rows().length === options.filter((x) => !x.via).length);
    await o.update({ ...optionsProps, held: false });
    check("a revision keeps the filter, and says the holds are released", rows().length === options.filter((x) => !x.via).length && text(o.el).includes("Holds released"));
    await click(o.el.querySelector('[data-key="filter:all"]'));
    const first = options[0];
    await focus(keyed(o.el, `option:${first.id}`));
    await click(keyed(o.el, `option:${first.id}`));
    check("an option sends choose: its id", sentIs(o, [["choose", first.id]]));
    check("while it's on its way, nothing else can be chosen", [...o.el.querySelectorAll("[data-key^='option:']")].every((b) => b.disabled));
    await o.release();
    const row = keyed(o.el, `option:${first.id}`);
    check("refused, it stays live, nothing picked, the keyboard where it was", !row.disabled && !row.classList.contains("border-primary") && document.activeElement === row);
    await click(keyed(o.el, `option:${first.id}`));
    await o.fail();
    check("a send that fails does the same, and is logged", !keyed(o.el, `option:${first.id}`).disabled && logged.some((l) => l.includes("the click wasn't sent")));
    await o.freeze(first.id);
    check("frozen, it says what was chosen, and the rows are rows", text(o.el).includes(`You chose ${first.flights.join(" + ")}.`) && !o.el.querySelector("[data-key^='option:']"));
    const closed = await mount("rebooking_options", optionsProps, { state: "frozen" });
    check("closed by typing, it says so", text(closed.el).includes("Closed when you typed instead."));
  }

  // ── the seat map
  console.log("\nseat_map");
  const rows = seatRows("NH 7");
  const seatProps = { purpose: "rebook", optionId: "o05", flight: "NH 7", airline: "ANA", rows };
  {
    const s = await mount("seat_map", seatProps);
    const free = rows.flatMap((r) => r.seats).filter((x) => !x.taken);
    const taken = rows.flatMap((r) => r.seats).find((x) => x.taken);
    check(`it shows ${free.length} free seats`, text(s.el).includes(`${free.length} free`));
    check("a taken seat is disabled, and says so", keyed(s.el, `seat:${taken.id}`).disabled && keyed(s.el, `seat:${taken.id}`).getAttribute("aria-label").endsWith(", taken"));
    const [a, b] = free;
    await focus(keyed(s.el, `seat:${a.id}`));
    const takeA = rows.map((r) => ({ ...r, seats: r.seats.map((x) => (x.id === a.id ? { ...x, taken: true } : x)) }));
    await s.update({ ...seatProps, rows: takeA });
    check(`seat ${a.id} taken under the keyboard: it moves to the next free seat, ${b.id}`, document.activeElement === keyed(s.el, `seat:${b.id}`));
    await click(keyed(s.el, `seat:${b.id}`));
    check(`a seat sends pick: ${b.id}`, sentIs(s, [["pick", b.id]]));
    await s.release();
    check("refused, the keyboard is back on the seat", document.activeElement === keyed(s.el, `seat:${b.id}`) && !keyed(s.el, `seat:${b.id}`).disabled);
    await s.freeze(b.id);
    check("frozen, it says which seat", text(s.el).includes(`You picked seat ${b.id}.`) && buttons(s.el).every((x) => x.disabled));
  }

  // ── tonight
  console.log("\ncare_options");
  {
    const c = await mount("care_options", { night: "Tuesday night", flight: "NH 7", choices: CARE });
    await click(buttons(c.el).find((x) => x.textContent.startsWith("Hotel voucher")));
    check("a choice sends choose: its id", sentIs(c, [["choose", "hotel"]]));
    await c.freeze("hotel");
    check("frozen, every choice is disabled", buttons(c.el).every((x) => x.disabled));
    const closed = await mount("care_options", { night: "Tuesday night", flight: "NH 7", choices: CARE }, { state: "frozen" });
    check("closed by typing, it says so", text(closed.el).includes("Closed when you typed instead."));
  }

  // ── the review of a change that costs extra
  console.log("\nrebooking_review");
  const review = {
    passenger: TRIP.passenger,
    cancelled: "UA 837",
    optionId: "o03",
    flight: "ZG 25",
    airline: "Zipair",
    legs: [{ flight: "ZG 25", from: "SFO", to: "NRT" }],
    depart: "Tue 22:35",
    arrive: "Thu 01:35",
    seat: "14D",
    care: null,
    extraFare: 140,
    payment: PAYMENT,
  };
  {
    const r = await mount("rebooking_review", review);
    check("it shows the extra fare", text(r.el).includes("$140 extra") && text(r.el).includes(PAYMENT));
    await click(button(r.el, "Confirm and book · $140 extra"));
    check("Confirm sends the extra fare on screen", sentIs(r, [["confirm", { extraFare: 140 }]]));
    await r.release();
    await click(button(r.el, "Different seat"));
    check("Different seat sends change: seat", JSON.stringify(r.sent.at(-1)) === '["change","seat"]');
    await r.freeze({ extraFare: 140 });
    check("frozen, it says what was confirmed, and offers nothing", text(r.el).includes("You confirmed, at $140 extra.") && buttons(r.el).length === 0);
  }

  // ── the boarding pass
  console.log("\nboarding_pass");
  const pass = {
    passenger: TRIP.passenger,
    reference: "K7Q2MX",
    flight: "NH 7",
    airline: "ANA",
    legs: [{ flight: "NH 7", from: "SFO", to: "NRT", depart: "Wed 11:00" }],
    arrive: "Thu 14:45",
    seat: "14D",
    gate: "G92",
    boards: "10:20",
    care: "Hotel voucher: Grand Hyatt at SFO",
  };
  {
    const p = await mount("boarding_pass", pass, { mode: "display" });
    check("it shows the gate, and tonight", text(p.el).includes("G92") && text(p.el).includes("Tonight: Hotel voucher: Grand Hyatt at SFO.") && !text(p.el).includes("Gate changed"));
    await p.update({ ...pass, gate: "G99" });
    check("the gate moves: the pass says so, and marks it", text(p.el).includes("Gate changed from G92.") && [...p.el.querySelectorAll("dd")].some((dd) => dd.textContent === "G99" && dd.className.includes("animate-moved")));
  }

  // ── the flight home
  console.log("\nflight_search");
  const search = {
    passenger: TRIP.passenger,
    from: "TYO",
    to: HOME,
    date: null,
    days: [
      { id: "Fri", nights: 1 },
      { id: "Sun", nights: 3 },
    ],
    sources: { passenger: "your booking", from: "your trip", to: "your booking", date: null },
  };
  {
    const f = await mount("flight_search", search);
    check("with no day yet, it asks for one, and Search waits", text(f.el).includes("choose one") && button(f.el, "Choose a day to search").disabled);
    await click(keyed(f.el, "from:HND"));
    await click(keyed(f.el, "day:Sun"));
    check("the airport and the day change here, and send nothing", f.sent.length === 0 && text(f.el).includes("from you") && !!button(f.el, "Search flights on Sunday"));
    await click(button(f.el, "Search flights on Sunday"));
    check("Search sends the whole search", sentIs(f, [["search", { from: "HND", date: "Sun" }]]));
    await f.freeze({ from: "HND", date: "Sun" });
    check("frozen, it says what was searched", text(f.el).includes("You searched from Haneda to San Francisco on Sunday."));
  }

  console.log("\nflight_results");
  const flights = flightsHome("Sun");
  {
    const r = await mount("flight_results", { flights, date: "Sun", from: "TYO", total: flights.length, filter: null });
    check(`it lists ${flights.length} flights home`, r.el.querySelectorAll("ol > li").length === flights.length && text(r.el).includes(`${flights.length} flights to San Francisco`));
    await click(r.el.querySelector('[data-key="filter:HND"]'));
    check("Haneda filters the list here, and sends nothing", r.el.querySelectorAll("ol > li").length === flights.filter((x) => x.from === "HND").length && r.sent.length === 0);
    const hnd = flights.find((x) => x.from === "HND");
    await click(keyed(r.el, `flight:${hnd.id}`));
    check("a flight sends choose: its id", sentIs(r, [["choose", hnd.id]]));
    await r.freeze(hnd.id);
    check("frozen, it says what was chosen", text(r.el).includes(`You chose ${hnd.flights.join(" + ")}.`));
  }

  console.log("\nfare_options");
  const flight = flights[0];
  const fares = faresFor(flight);
  {
    const f = await mount("fare_options", { flightId: flight.id, flight: flight.flights.join(" + "), airline: flight.airline, date: "Sun", fares });
    check("it shows the three fares, and Basic's seat at check-in", fares.every((x) => text(f.el).includes(x.name)) && text(f.el).includes("Seat assigned at check-in"));
    await click(button(f.el, "Choose Standard"));
    check("a fare sends choose: its id", sentIs(f, [["choose", "standard"]]));
    await f.freeze("standard");
    check("frozen, it says which fare, at what price", text(f.el).includes(`You chose Standard, $${fares[1].price.toLocaleString("en-US")}.`));
  }

  console.log("\nbooking_review");
  const total = fares[1].price + 68;
  const booking = {
    passenger: TRIP.passenger,
    flightId: flight.id,
    airline: flight.airline,
    legs: [{ flight: flight.flights[0], from: flight.from, to: "SFO" }],
    depart: flight.depart,
    arrive: flight.arrive,
    fare: { id: "standard", name: "Standard", seatChoice: true },
    seat: "21C",
    price: { fare: fares[1].price, taxes: 68, total },
    previousTotal: null,
    payment: PAYMENT,
  };
  const usd = (n) => `$${n.toLocaleString("en-US")}`;
  {
    const b = await mount("booking_review", booking);
    check("with a fare that picks seats, it offers to change the flight, fare or seat", ["Change flight", "Change fare", "Change seat"].every((l) => !!button(b.el, l)));
    await b.update({ ...booking, price: { ...booking.price, fare: booking.price.fare + 60, total: total + 60 }, previousTotal: total });
    check("the airline raises the fare: the review says so", text(b.el).includes("Fare went up") && text(b.el).includes(`It was ${usd(total)}: the airline raised the fare a moment ago.`));
    await click(button(b.el, `Confirm and book · ${usd(total + 60)}`));
    check("Confirm sends the total on screen", sentIs(b, [["confirm", { total: total + 60 }]]));
    await b.release();
    await click(button(b.el, "Change fare"));
    check("Change fare sends change: fare", JSON.stringify(b.sent.at(-1)) === '["change","fare"]');
    await b.freeze("fare");
    check("frozen, it says what was asked", text(b.el).includes("You asked to change the fare.") && buttons(b.el).length === 0);
    const basic = await mount("booking_review", { ...booking, fare: { id: "basic", name: "Basic", seatChoice: false }, seat: null });
    check("with Basic, there's no seat to change, and it's at check-in", !button(basic.el, "Change seat") && text(basic.el).includes("At check-in"));
  }

  console.log("\nbooking_confirmed");
  {
    const c = await mount(
      "booking_confirmed",
      { passenger: TRIP.passenger, reference: "HM7K2P", legs: booking.legs, depart: flight.depart, arrive: flight.arrive, fare: "Standard", seat: "21C", bags: "1 checked bag", total },
      { mode: "display" },
    );
    check("the e-ticket shows what was paid", text(c.el).includes("E-ticket · flight home") && text(c.el).includes(usd(total)) && text(c.el).includes("1 checked bag"));
  }

  // ── notices
  console.log("\nnotices");
  async function notice(name, payload) {
    const el = document.createElement("div");
    document.body.append(el);
    await act(async () => void notices[name].mount(el, payload, { seq: 1, version: 1 }));
    return el;
  }
  {
    const cancelled = await notice("flight_cancelled", { flight: "UA 837", depart: "Tue 18:05", reason: "a crew shortage" });
    check("flight_cancelled says which flight, and why", text(cancelled).includes("UA 837 cancelled") && text(cancelled).includes("because of a crew shortage"));
    const seat = await notice("seat_confirmed", { flight: "NH 7", seat: "14D", reference: "K7Q2MX" });
    check("seat_confirmed says which seat", text(seat).includes("Seat 14D confirmed"));
    const ticket = await notice("ticket_issued", { reference: "HM7K2P", ticket: "016-0123456789", flight: "UA 838" });
    check("ticket_issued says which ticket", text(ticket).includes("016-0123456789"));
    check("no notice interrupts as an alert", !document.querySelector('[role="alert"]'));
  }

  // ── payload text stays text
  console.log("\ntext, never HTML");
  {
    const t = await mount("trip_card", { ...TRIP, passenger: "<b>Alex</b>", status: "cancelled", reason: "<img src=x onerror=alert(1)>" }, { mode: "display" });
    check("markup in a payload is drawn as its characters", !t.el.querySelector("b, img") && text(t.el).includes("<b>Alex</b>") && text(t.el).includes("<img src=x onerror=alert(1)>"));
  }

  // ── the Airline ops bar
  console.log("\nops bar");
  {
    const posted = [];
    globalThis.fetch = async (url, init) => {
      posted.push([url, JSON.parse(init.body)]);
      return { ok: true, status: 200, json: async () => ({ message: "The airline cancelled UA 837." }) };
    };
    const subscribers = [];
    const chat = { state: { conversationId: "c_1" }, subscribe: (fn) => (subscribers.push(fn), () => subscribers.splice(subscribers.indexOf(fn), 1)) };
    const hear = (event) => act(async () => subscribers.forEach((fn) => fn(chat.state, event)));
    const el = document.createElement("div");
    document.body.append(el);
    const root = createRoot(el);
    await act(async () => root.render(createElement(OpsBar, { chat })));
    check("it offers the airline's four actions", ["Cancel the flight", "Release the holds", "Change the gate", "Raise the fare"].every((l) => buttons(el).some((b) => b.textContent.startsWith(l))));
    await hear({ type: "ui_open", component: "trip_card", handle: "ui_01" });
    const cancel = buttons(el).find((b) => b.textContent.startsWith("Cancel the flight"));
    check("the trip opens: the countdown starts, on Cancel the flight", /30s$/.test(cancel.textContent) && text(el).includes("If you don't cancel UA 837, the airline will, in 30 seconds."));
    await hear({ type: "ui_open", component: "flight_search", handle: "ui_02" });
    check("booking the flight home stops it, and says so", !/\d+s$/.test(cancel.textContent) && text(el).includes("You're booking the flight home"));
    await click(cancel);
    check("a button posts its route with the conversation", JSON.stringify(posted) === '[["/ops/cancel",{"conversationId":"c_1"}]]' && text(el).includes("The airline cancelled UA 837."));
    await act(async () => root.unmount());
    check("unmounted, it stops listening", subscribers.length === 0);
  }
} finally {
  await vite.close();
}

console.log(failures ? `\n${failures} check(s) failed\n` : "\nclienttest: all checks passed\n");
process.exit(failures ? 1 : 0);
