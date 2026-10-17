/**
 * The browser halves of Rebook's surfaces and notices.
 *
 * Typechecked against ../src/shared/, the same contracts the server
 * implements: change a prop there and this file fails `npm run typecheck`.
 *
 * Everything is built with textContent, never HTML. Tool payloads are
 * untrusted input, even when the tool is your own. A click reaches the server
 * only through an action the contract declares; filtering and the rest stay
 * here.
 */

/** @typedef {import("../src/shared/surfaces.ts").TripCardProps} TripCardProps */
/** @typedef {import("../src/shared/surfaces.ts").RebookingOptionsProps} RebookingOptionsProps */
/** @typedef {import("../src/shared/surfaces.ts").RebookOption} RebookOption */
/** @typedef {import("../src/shared/surfaces.ts").SeatMapProps} SeatMapProps */
/** @typedef {import("../src/shared/surfaces.ts").CareOptionsProps} CareOptionsProps */
/** @typedef {import("../src/shared/surfaces.ts").BoardingPassProps} BoardingPassProps */
/** @typedef {import("../src/shared/surfaces.ts").FlightSearchProps} FlightSearchProps */
/** @typedef {import("../src/shared/surfaces.ts").FlightResultsProps} FlightResultsProps */
/** @typedef {import("../src/shared/surfaces.ts").HomeFlight} HomeFlight */
/** @typedef {import("../src/shared/surfaces.ts").FareOptionsProps} FareOptionsProps */
/** @typedef {import("../src/shared/surfaces.ts").BookingReviewProps} BookingReviewProps */
/** @typedef {import("../src/shared/surfaces.ts").BookingConfirmedProps} BookingConfirmedProps */
/** @typedef {import("../src/shared/surfaces.ts").Day} Day */
/** @typedef {import("../src/shared/surfaces.ts").TokyoAirport} TokyoAirport */
/** @typedef {import("@haikit/core").Infer<typeof import("../src/shared/notices.ts").flightCancelled.payload>} FlightCancelled */
/** @typedef {import("@haikit/core").Infer<typeof import("../src/shared/notices.ts").seatConfirmed.payload>} SeatConfirmed */
/** @typedef {import("@haikit/core").Infer<typeof import("../src/shared/notices.ts").ticketIssued.payload>} TicketIssued */
/** @typedef {import("@haikit/client").MountCtx} MountCtx */

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {string | null} [className]
 * @param {string | null} [text]
 * @returns {HTMLElementTagNameMap[K]}
 */
const h = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

/** "16h45" */
const later = (/** @type {number} */ min) => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;

/** "$1,250" */
const dollars = (/** @type {number} */ n) => `$${n.toLocaleString("en-US")}`;

/** @type {Record<Day, string>} */
const DAY_NAMES = { Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday", Mon: "Monday" };
/** @type {Record<TokyoAirport, string>} */
const AIRPORTS = { TYO: "Any Tokyo airport", NRT: "Narita · NRT", HND: "Haneda · HND" };
/** @type {Record<TokyoAirport, string>} the airport in a sentence */
const FROM = { TYO: "any Tokyo airport", NRT: "Narita", HND: "Haneda" };

/** A surface's head: what it is, a line under it, and its state on the right. */
function head(/** @type {string} */ title, /** @type {string} */ sub, /** @type {HTMLElement | null} */ badge) {
  const top = h("div", "rb-head");
  const words = h("div", "rb-head-words");
  words.append(h("p", "rb-title", title), h("p", "rb-sub", sub));
  top.append(words);
  if (badge) top.append(badge);
  return top;
}

const badge = (/** @type {string} */ text, /** @type {string} */ tone) => h("span", `rb-badge rb-badge-${tone}`, text);

/** The control that has the keyboard, by the key it was drawn with, if it's inside `el`. */
const focusedKey = (/** @type {HTMLElement} */ el) => {
  const active = document.activeElement;
  return active instanceof HTMLElement && el.contains(active) ? active.dataset.key : undefined;
};

/**
 * Redraw a surface without losing the keyboard's place. Each control is drawn
 * with a `data-key`, such as `seat:14D`. The control with the focused key gets
 * the focus back. If it's gone or disabled now, as a seat just taken is, the
 * nearest enabled control of its kind does: the next one after it, or else
 * the one before.
 * @param {HTMLElement} el
 * @param {() => void} draw
 * @param {string} [key] the key to return to, when the focus has already left
 */
function redraw(el, draw, key = focusedKey(el)) {
  const order = key ? [...el.querySelectorAll("button[data-key]")].map((b) => /** @type {HTMLElement} */ (b).dataset.key ?? "") : [];
  draw();
  if (!key) return;
  const enabled = (/** @type {string} */ k) => {
    const b = el.querySelector(`button[data-key="${CSS.escape(k)}"]`);
    return b instanceof HTMLButtonElement && !b.disabled ? b : null;
  };
  const kind = key.slice(0, key.indexOf(":") + 1);
  const at = order.indexOf(key);
  const around = [...order.slice(at + 1), ...order.slice(0, Math.max(at, 0)).reverse()].filter((k) => k.startsWith(kind));
  (enabled(key) ?? around.map(enabled).find(Boolean))?.focus({ preventScroll: true });
}

/**
 * The parked-turn pattern every question here shares: a click sends the
 * declared action and waits; if the surface is still live afterwards, the
 * server refused it, and the component lets the traveller try again, with the
 * keyboard back where it was. A send that fails outright does the same.
 * @param {HTMLElement} el
 * @param {MountCtx} ctx
 * @param {{ state: string, picked: unknown, sending: boolean }} at
 * @param {() => void} draw
 */
const asker = (el, ctx, at, draw) => async (/** @type {string} */ action, /** @type {unknown} */ value) => {
  const key = focusedKey(el);
  at.sending = true;
  at.picked = value;
  redraw(el, draw, key);
  try {
    await ctx.send(action, value);
  } catch (err) {
    console.error("[rebook] the click wasn't sent:", err);
  } finally {
    at.sending = false;
    if (at.state === "live") {
      at.picked = undefined; // refused: the reason shows in the transcript, and this stays live
      redraw(el, draw, key);
    }
  }
};

/**
 * Scroll the transcript so a new question opens at its top, with the tool row
 * above it: above the window, it would show its last lines, and below, the
 * traveller would miss it. The default UI follows the newest content to the
 * bottom, and tells the reader's scrolling from its own by the scroll events,
 * so one goes with the move. Outside a transcript, or with its top already in
 * the upper half of the window, this does nothing.
 * @param {HTMLElement} surface the element a surface mounted into
 */
function showTop(surface) {
  const transcript = surface.closest(".hai-transcript");
  if (!(transcript instanceof HTMLElement)) return;
  const first = surface.previousElementSibling ?? surface;
  const offset = first.getBoundingClientRect().top - transcript.getBoundingClientRect().top - 16;
  if (offset >= 0 && offset < transcript.clientHeight / 2) return;
  transcript.scrollTop += offset;
  transcript.dispatchEvent(new Event("scroll"));
}

export const registry = {
  trip_card: {
    /**
     * @param {HTMLElement} el
     * @param {TripCardProps} props
     * @param {MountCtx} ctx
     */
    mount(el, props, ctx) {
      let sending = false;
      const draw = () => {
        el.replaceChildren();
        const cancelled = props.status === "cancelled";
        const card = h("div", `rb-card rb-trip${cancelled ? " is-cancelled" : ""}`);
        card.append(head("Your trip", `${props.passenger} · booking ${props.reference}`, cancelled ? badge("Cancelled", "alert") : badge("On time", "ok")));

        const route = h("div", "rb-route");
        for (const [end, time] of /** @type {const} */ ([[props.from, props.depart], [props.to, props.arrive]])) {
          const stop = h("div", "rb-stop");
          stop.append(h("span", "rb-code", end.code), h("span", "rb-city", end.city), h("span", "rb-time", time));
          route.append(stop);
        }
        route.insertBefore(h("span", "rb-arrow", "→"), route.lastChild);
        card.append(route);

        const facts = h("dl", "rb-facts");
        for (const [k, v] of [["Flight", `${props.airline} ${props.flight}`], ["Seat", props.seat]]) {
          const pair = h("div");
          pair.append(h("dt", null, k), h("dd", null, v));
          facts.append(pair);
        }
        card.append(facts);
        if (cancelled && props.reason) card.append(h("p", "rb-why", `Cancelled because of ${props.reason}.`));

        // the flight home: booked, or a button that asks the guide to book it
        const home = h("div", "rb-home");
        if (props.home) {
          home.append(h("span", "rb-home-label", "Flight home"), h("span", "rb-home-what", `${props.home.flight} · ${props.home.depart} · booking ${props.home.reference}`));
        } else {
          home.append(h("span", "rb-home-label", "Flight home"), h("span", "rb-home-what", "Not booked yet"));
          const b = h("button", "rb-button", "Book my flight home");
          b.type = "button";
          b.dataset.key = "home:book";
          b.disabled = sending || ctx.state !== "live";
          // DECLARED: `book_home` is an inform action. It tells the guide, which
          // starts the booking; nothing waits on this card. A click the server
          // refuses, such as one while a question waits, resolves all the same,
          // so the button stays: the card is revised once the flight is booked.
          b.onclick = async () => {
            sending = true;
            redraw(el, draw);
            try {
              await ctx.send("book_home", "home");
            } catch (err) {
              console.error("[rebook] the click wasn't sent:", err);
            } finally {
              sending = false;
              redraw(el, draw);
            }
          };
          home.append(b);
        }
        card.append(home);
        el.append(card);
      };
      draw();
      // The airline revises the card in place when it cancels the flight, and
      // when the flight home is booked.
      return { update(/** @type {TripCardProps} */ next) { props = next; redraw(el, draw); } };
    },
  },

  rebooking_options: {
    /**
     * @param {HTMLElement} el
     * @param {RebookingOptionsProps} props
     * @param {MountCtx} ctx
     */
    mount(el, props, ctx) {
      const at = { state: /** @type {string} */ (ctx.state), picked: ctx.selection, sending: false };
      // LOCAL: the contract declares no action for filtering, so it never
      // reaches the server or costs the model a turn.
      /** @type {"all" | "nonstop" | "free" | "tonight"} */
      let only = "all";
      const FILTERS = /** @type {const} */ ([
        ["all", "All", (/** @type {RebookOption} */ _o) => true],
        ["nonstop", "Nonstop", (/** @type {RebookOption} */ o) => !o.via],
        ["free", "No extra cost", (/** @type {RebookOption} */ o) => o.extraFare === 0],
        ["tonight", "Tonight", (/** @type {RebookOption} */ o) => o.tonight],
      ]);

      const draw = () => {
        const live = at.state === "live" && ctx.mode === "elicit";
        el.replaceChildren();
        const card = h("div", "rb-card rb-options");
        const sub = props.filter ? `${props.options.length} ${props.filter}, of ${props.total}` : `${props.options.length} ways to get there`;
        card.append(
          head(`Instead of ${props.cancelled}`, sub, live ? badge(props.held ? "Seats held · 5 min" : "Holds released", props.held ? "wait" : "alert") : null),
        );

        const chips = h("div", "rb-chips");
        chips.setAttribute("role", "group");
        chips.setAttribute("aria-label", "Show");
        for (const [key, label] of FILTERS) {
          const chip = h("button", `rb-chip${only === key ? " is-on" : ""}`, label);
          chip.type = "button";
          chip.dataset.key = `filter:${key}`;
          chip.setAttribute("aria-pressed", String(only === key));
          chip.onclick = () => { only = key; redraw(el, draw); };
          chips.append(chip);
        }
        card.append(chips);

        const keep = FILTERS.find(([key]) => key === only)?.[2] ?? (() => true);
        const list = h("ol", "rb-list");
        for (const o of props.options.filter(keep)) {
          const gone = o.seatsLeft === 0;
          const row = h(live && !gone ? "button" : "div", `rb-option${o.id === at.picked ? " is-picked" : ""}${gone ? " is-gone" : ""}`);
          if (row instanceof HTMLButtonElement) {
            row.type = "button";
            row.dataset.key = `option:${o.id}`;
            row.disabled = at.sending;
            row.onclick = () => void ask("choose", o.id); // DECLARED: `choose` is a resolve action
          }
          const times = h("span", "rb-times");
          times.append(h("span", "rb-time", o.depart), h("span", "rb-arrow", "→"), h("span", "rb-time", o.arrive));
          const what = h("span", "rb-what");
          what.append(
            h("span", "rb-flights", `${o.flights.join(" + ")} · ${o.airline}`),
            h("span", "rb-detail", `${o.via ? `via ${o.via}` : "Nonstop"} · lands ${later(o.laterMin)} later${o.tonight ? " · leaves tonight" : ""}`),
          );
          const cost = h("span", "rb-cost");
          cost.append(
            h("span", o.extraFare ? "rb-fare" : "rb-fare is-free", o.extraFare ? `+$${o.extraFare}` : "No extra cost"),
            h("span", gone ? "rb-left is-out" : o.seatsLeft <= 2 ? "rb-left is-low" : "rb-left", gone ? "Sold out" : `${o.seatsLeft} seats left`),
          );
          row.append(times, what, cost);
          const li = h("li");
          li.append(row);
          list.append(li);
        }
        card.append(list);

        const foot = h("p", "rb-foot");
        if (!live && at.state === "frozen") {
          const o = props.options.find((x) => x.id === at.picked);
          foot.textContent = o ? `You chose ${o.flights.join(" + ")}.` : "Closed when you typed instead.";
        } else {
          foot.textContent = "Filters work here, in your browser: no round trip to the model.";
        }
        card.append(foot);
        el.append(card);
      };
      const ask = asker(el, ctx, at, draw);

      draw();
      // Fourteen options are taller than the window: open on the first.
      if (ctx.state === "live") requestAnimationFrame(() => showTop(el));
      return {
        freeze(/** @type {unknown} */ selection) { at.state = "frozen"; at.picked = selection; redraw(el, draw); },
        // A revision from the airline, such as its holds running out: the
        // filter the traveller chose stays as it was, and so does the keyboard.
        update(/** @type {RebookingOptionsProps} */ next) { props = next; redraw(el, draw); },
      };
    },
  },

  seat_map: {
    /**
     * @param {HTMLElement} el
     * @param {SeatMapProps} props
     * @param {MountCtx} ctx
     */
    mount(el, props, ctx) {
      const at = { state: /** @type {string} */ (ctx.state), picked: ctx.selection, sending: false };
      const draw = () => {
        const live = at.state === "live" && ctx.mode === "elicit";
        el.replaceChildren();
        const card = h("div", "rb-card rb-seats");
        const free = props.rows.flatMap((r) => r.seats).filter((s) => !s.taken).length;
        card.append(head(`Pick a seat on ${props.flight}`, `${props.airline} · economy · ${free} free`, live ? badge("Other passengers are choosing", "wait") : null));

        const grid = h("div", "rb-grid");
        for (const row of props.rows) {
          const line = h("div", "rb-row");
          line.append(h("span", "rb-rownum", String(row.row)));
          row.seats.forEach((seat, i) => {
            if (i === 3) line.append(h("span", "rb-aisle"));
            const b = h("button", ["rb-seat", seat.taken ? "is-taken" : "", seat.extraLegroom ? "is-legroom" : "", seat.id === at.picked ? "is-picked" : ""].filter(Boolean).join(" "), seat.letter);
            b.type = "button";
            b.dataset.key = `seat:${seat.id}`;
            b.disabled = seat.taken || !live || at.sending;
            b.setAttribute("aria-label", `Seat ${seat.id}${seat.window ? ", window" : ""}${seat.extraLegroom ? ", extra legroom" : ""}${seat.taken ? ", taken" : ""}`);
            b.onclick = () => void ask("pick", seat.id); // DECLARED: `pick` is a resolve action
            line.append(b);
          });
          grid.append(line);
        }
        card.append(grid);
        card.append(
          h(
            "p",
            "rb-foot",
            at.state === "frozen"
              ? typeof at.picked === "string" ? `You picked seat ${at.picked}.` : "Closed when you typed instead."
              : "Green seats have extra legroom. Seats go grey as other passengers take them.",
          ),
        );
        el.append(card);
      };
      const ask = asker(el, ctx, at, draw);
      draw();
      if (ctx.state === "live") requestAnimationFrame(() => showTop(el));
      return {
        freeze(/** @type {unknown} */ selection) { at.state = "frozen"; at.picked = selection; redraw(el, draw); },
        // Another passenger took a seat: the map is revised in place, every
        // few seconds, so the keyboard stays on the seat it was on.
        update(/** @type {SeatMapProps} */ next) { props = next; redraw(el, draw); },
      };
    },
  },

  care_options: {
    /**
     * @param {HTMLElement} el
     * @param {CareOptionsProps} props
     * @param {MountCtx} ctx
     */
    mount(el, props, ctx) {
      const at = { state: /** @type {string} */ (ctx.state), picked: ctx.selection, sending: false };
      const draw = () => {
        const live = at.state === "live" && ctx.mode === "elicit";
        el.replaceChildren();
        const card = h("div", "rb-card rb-care");
        card.append(head("Where will you spend tonight?", `${props.night}, before ${props.flight}`, null));
        const list = h("div", "rb-choices");
        for (const c of props.choices) {
          const b = h("button", `rb-choice${c.id === at.picked ? " is-picked" : ""}`);
          b.type = "button";
          b.dataset.key = `care:${c.id}`;
          b.disabled = !live || at.sending;
          b.onclick = () => void ask("choose", c.id); // DECLARED
          b.append(h("span", "rb-choice-title", c.title), h("span", "rb-choice-detail", c.detail));
          list.append(b);
        }
        card.append(list);
        if (at.state === "frozen" && !props.choices.some((c) => c.id === at.picked)) card.append(h("p", "rb-foot", "Closed when you typed instead."));
        el.append(card);
      };
      const ask = asker(el, ctx, at, draw);
      draw();
      if (ctx.state === "live") requestAnimationFrame(() => showTop(el));
      return { freeze(/** @type {unknown} */ selection) { at.state = "frozen"; at.picked = selection; redraw(el, draw); } };
    },
  },

  boarding_pass: {
    /**
     * @param {HTMLElement} el
     * @param {BoardingPassProps} props
     * @param {MountCtx} ctx
     */
    mount(el, props, ctx) {
      /** @type {string | null} the gate before the latest revision, while it's news */
      let movedFrom = null;
      const draw = () => {
        el.replaceChildren();
        const card = h("div", "rb-card rb-pass");
        card.append(head("Boarding pass", `${props.passenger} · booking ${props.reference}`, badge("Booked", "ok")));
        const legs = h("div", "rb-legs");
        for (const leg of props.legs) {
          const row = h("div", "rb-leg");
          row.append(h("span", "rb-code", leg.from), h("span", "rb-arrow", "→"), h("span", "rb-code", leg.to), h("span", "rb-leg-flight", `${leg.flight} · ${leg.depart}`));
          legs.append(row);
        }
        card.append(legs);
        const facts = h("dl", "rb-facts rb-facts-pass");
        for (const [k, v, cls] of [["Gate", props.gate, movedFrom ? "is-moved" : ""], ["Boards", props.boards, ""], ["Seat", props.seat, ""], ["Lands", props.arrive, ""]]) {
          const pair = h("div", cls || null);
          pair.append(h("dt", null, k), h("dd", null, v));
          facts.append(pair);
        }
        card.append(facts);
        if (movedFrom) card.append(h("p", "rb-why", `Gate changed from ${movedFrom}.`));
        if (props.care) card.append(h("p", "rb-foot", `Tonight: ${props.care}.`));
        el.append(card);
      };
      draw();
      if (ctx.state === "live") requestAnimationFrame(() => showTop(el));
      return {
        // The airline moved the gate: the pass is revised in place, and says so.
        update(/** @type {BoardingPassProps} */ next) {
          if (next.gate !== props.gate) movedFrom = props.gate;
          props = next;
          draw();
        },
      };
    },
  },

  // ── booking the flight home ──────────────────────────────────────────

  flight_search: {
    /**
     * The search, filled in from what the guide knows. Changing the day or
     * the airport is LOCAL: it stays here until Search sends the whole search
     * through the declared `search` action.
     * @param {HTMLElement} el
     * @param {FlightSearchProps} props
     * @param {MountCtx} ctx
     */
    mount(el, props, ctx) {
      const at = { state: /** @type {string} */ (ctx.state), picked: ctx.selection, sending: false };
      let from = props.from;
      let date = props.date;
      const draw = () => {
        const live = at.state === "live" && ctx.mode === "elicit";
        el.replaceChildren();
        const card = h("div", "rb-card rb-search");
        card.append(head("Book your flight home", "Filled in from what Rebook already knows. Change anything, then search.", null));

        const fields = h("div", "rb-fields");
        /** @param {string} label @param {HTMLElement | string} value @param {string | null} source */
        const field = (label, value, source) => {
          const row = h("div", "rb-field");
          row.append(h("span", "rb-field-label", label));
          row.append(typeof value === "string" ? h("span", "rb-field-value", value) : value);
          row.append(h("span", source ? "rb-source" : "rb-source is-missing", source ? `from ${source}` : "choose one"));
          fields.append(row);
        };
        field("Traveller", props.passenger, props.sources.passenger);

        const airports = h("div", "rb-segments");
        airports.setAttribute("role", "group");
        airports.setAttribute("aria-label", "From");
        for (const id of /** @type {TokyoAirport[]} */ (["TYO", "NRT", "HND"])) {
          const b = h("button", `rb-chip${from === id ? " is-on" : ""}`, AIRPORTS[id]);
          b.type = "button";
          b.dataset.key = `from:${id}`;
          b.disabled = !live || at.sending;
          b.setAttribute("aria-pressed", String(from === id));
          b.onclick = () => { from = id; redraw(el, draw); }; // LOCAL
          airports.append(b);
        }
        field("From", airports, from === props.from ? props.sources.from : "you");
        field("To", `${props.to.city} · ${props.to.code}`, props.sources.to);

        const days = h("div", "rb-segments");
        days.setAttribute("role", "group");
        days.setAttribute("aria-label", "Day");
        for (const d of props.days) {
          const b = h("button", `rb-chip rb-day${date === d.id ? " is-on" : ""}`);
          b.type = "button";
          b.dataset.key = `day:${d.id}`;
          b.disabled = !live || at.sending;
          b.setAttribute("aria-pressed", String(date === d.id));
          b.append(h("span", null, d.id), h("span", "rb-day-nights", `${d.nights} night${d.nights === 1 ? "" : "s"}`));
          b.onclick = () => { date = d.id; redraw(el, draw); }; // LOCAL
          days.append(b);
        }
        field("Day", days, date === null ? null : date === props.date ? props.sources.date : "you");
        card.append(fields);

        if (at.state === "frozen") {
          const sel = /** @type {{ from?: TokyoAirport, date?: Day } | undefined} */ (at.picked);
          card.append(h("p", "rb-foot", sel?.date && sel.from ? `You searched from ${FROM[sel.from]} to San Francisco on ${DAY_NAMES[sel.date]}.` : "Closed when you typed instead."));
        } else {
          const go = h("button", "rb-button is-primary", date ? `Search flights on ${DAY_NAMES[date]}` : "Choose a day to search");
          go.type = "button";
          go.dataset.key = "search:go";
          go.disabled = !live || at.sending || !date;
          go.onclick = () => { if (date) void ask("search", { from, date }); }; // DECLARED: `search` is a resolve action
          card.append(go);
        }
        el.append(card);
      };
      const ask = asker(el, ctx, at, draw);
      draw();
      if (ctx.state === "live") requestAnimationFrame(() => showTop(el));
      return { freeze(/** @type {unknown} */ selection) { at.state = "frozen"; at.picked = selection; redraw(el, draw); } };
    },
  },

  flight_results: {
    /**
     * @param {HTMLElement} el
     * @param {FlightResultsProps} props
     * @param {MountCtx} ctx
     */
    mount(el, props, ctx) {
      const at = { state: /** @type {string} */ (ctx.state), picked: ctx.selection, sending: false };
      // LOCAL: no action is declared for filtering, so it stays in the browser.
      /** @type {"all" | "nonstop" | "NRT" | "HND"} */
      let only = "all";
      const FILTERS = /** @type {const} */ ([
        ["all", "All", (/** @type {HomeFlight} */ _f) => true],
        ["nonstop", "Nonstop", (/** @type {HomeFlight} */ f) => !f.via],
        ["NRT", "Narita", (/** @type {HomeFlight} */ f) => f.from === "NRT"],
        ["HND", "Haneda", (/** @type {HomeFlight} */ f) => f.from === "HND"],
      ]);
      const draw = () => {
        const live = at.state === "live" && ctx.mode === "elicit";
        el.replaceChildren();
        const card = h("div", "rb-card rb-options");
        const sub = props.filter ? `${props.flights.length} ${props.filter}, of ${props.total}` : `${props.flights.length} flights to San Francisco`;
        card.append(head(`Flights home · ${DAY_NAMES[props.date]}`, sub, null));

        const chips = h("div", "rb-chips");
        chips.setAttribute("role", "group");
        chips.setAttribute("aria-label", "Show");
        for (const [key, label] of FILTERS) {
          const chip = h("button", `rb-chip${only === key ? " is-on" : ""}`, label);
          chip.type = "button";
          chip.dataset.key = `filter:${key}`;
          chip.setAttribute("aria-pressed", String(only === key));
          chip.onclick = () => { only = key; redraw(el, draw); };
          chips.append(chip);
        }
        card.append(chips);

        const keep = FILTERS.find(([key]) => key === only)?.[2] ?? (() => true);
        const list = h("ol", "rb-list");
        for (const f of props.flights.filter(keep)) {
          const row = h(live ? "button" : "div", `rb-option${f.id === at.picked ? " is-picked" : ""}`);
          if (row instanceof HTMLButtonElement) {
            row.type = "button";
            row.dataset.key = `flight:${f.id}`;
            row.disabled = at.sending;
            row.onclick = () => void ask("choose", f.id); // DECLARED: `choose` is a resolve action
          }
          const times = h("span", "rb-times");
          times.append(h("span", "rb-time", f.depart.slice(4)), h("span", "rb-arrow", "→"), h("span", "rb-time", f.arrive.slice(4)));
          const what = h("span", "rb-what");
          what.append(
            h("span", "rb-flights", `${f.flights.join(" + ")} · ${f.airline}`),
            h("span", "rb-detail", `${f.from} · ${f.via ? `via ${f.via}` : "Nonstop"} · ${later(f.durationMin)} · lands the same day`),
          );
          const cost = h("span", "rb-cost");
          cost.append(h("span", "rb-fare", `from ${dollars(f.price)}`), h("span", f.seatsLeft <= 2 ? "rb-left is-low" : "rb-left", `${f.seatsLeft} seat${f.seatsLeft === 1 ? "" : "s"} left`));
          row.append(times, what, cost);
          const li = h("li");
          li.append(row);
          list.append(li);
        }
        card.append(list);
        const foot = h("p", "rb-foot");
        if (at.state === "frozen") {
          const f = props.flights.find((x) => x.id === at.picked);
          foot.textContent = f ? `You chose ${f.flights.join(" + ")}.` : "Closed when you typed instead.";
        } else {
          foot.textContent = "Times are local: Tokyo when it leaves, San Francisco when it lands. Prices are the Basic fare, before taxes.";
        }
        card.append(foot);
        el.append(card);
      };
      const ask = asker(el, ctx, at, draw);
      draw();
      if (ctx.state === "live") requestAnimationFrame(() => showTop(el));
      return { freeze(/** @type {unknown} */ selection) { at.state = "frozen"; at.picked = selection; redraw(el, draw); } };
    },
  },

  fare_options: {
    /**
     * @param {HTMLElement} el
     * @param {FareOptionsProps} props
     * @param {MountCtx} ctx
     */
    mount(el, props, ctx) {
      const at = { state: /** @type {string} */ (ctx.state), picked: ctx.selection, sending: false };
      const draw = () => {
        const live = at.state === "live" && ctx.mode === "elicit";
        el.replaceChildren();
        const card = h("div", "rb-card rb-fares");
        card.append(head(`Choose a fare on ${props.flight}`, `${props.airline} · ${DAY_NAMES[props.date]} · before taxes`, null));
        const grid = h("div", "rb-fare-grid");
        for (const fare of props.fares) {
          const col = h("div", `rb-fare-card${fare.id === at.picked ? " is-picked" : ""}`);
          col.append(h("p", "rb-fare-name", fare.name), h("p", "rb-fare-price", dollars(fare.price)));
          const list = h("ul", "rb-includes");
          for (const item of fare.includes) {
            const li = h("li", item.yes ? "is-yes" : "is-no");
            li.append(h("span", "rb-mark", item.yes ? "✓" : "✕"), h("span", null, item.text));
            li.setAttribute("aria-label", `${item.yes ? "Includes" : "Doesn't include"}: ${item.text}`);
            list.append(li);
          }
          if (!fare.seatChoice) {
            const li = h("li", "is-no");
            li.append(h("span", "rb-mark", "·"), h("span", null, "Seat assigned at check-in"));
            list.append(li);
          }
          col.append(list);
          const b = h("button", `rb-button${fare.id === "standard" ? " is-primary" : ""}`, `Choose ${fare.name}`);
          b.type = "button";
          b.dataset.key = `fare:${fare.id}`;
          b.disabled = !live || at.sending;
          b.onclick = () => void ask("choose", fare.id); // DECLARED
          col.append(b);
          grid.append(col);
        }
        card.append(grid);
        if (at.state === "frozen") {
          const fare = props.fares.find((f) => f.id === at.picked);
          card.append(h("p", "rb-foot", fare ? `You chose ${fare.name}, ${dollars(fare.price)}.` : "Closed when you typed instead."));
        }
        el.append(card);
      };
      const ask = asker(el, ctx, at, draw);
      draw();
      if (ctx.state === "live") requestAnimationFrame(() => showTop(el));
      return { freeze(/** @type {unknown} */ selection) { at.state = "frozen"; at.picked = selection; redraw(el, draw); } };
    },
  },

  booking_review: {
    /**
     * Nothing is booked until Confirm. Its click carries the total on screen,
     * so a total the airline has just raised is refused, not charged.
     * @param {HTMLElement} el
     * @param {BookingReviewProps} props
     * @param {MountCtx} ctx
     */
    mount(el, props, ctx) {
      const at = { state: /** @type {string} */ (ctx.state), picked: ctx.selection, sending: false };
      const draw = () => {
        const live = at.state === "live" && ctx.mode === "elicit";
        el.replaceChildren();
        const card = h("div", "rb-card rb-review");
        card.append(head("Check your booking", "Nothing is booked until you confirm", props.previousTotal !== null ? badge("Fare went up", "alert") : null));

        const legs = h("div", "rb-legs");
        for (const leg of props.legs) {
          const row = h("div", "rb-leg");
          row.append(h("span", "rb-code", leg.from), h("span", "rb-arrow", "→"), h("span", "rb-code", leg.to), h("span", "rb-leg-flight", leg.flight));
          legs.append(row);
        }
        card.append(legs);

        const facts = h("dl", "rb-facts");
        for (const [k, v] of [["Traveller", props.passenger], ["Leaves", props.depart], ["Lands", props.arrive], ["Fare", props.fare.name], ["Seat", props.seat ?? "At check-in"]]) {
          const pair = h("div");
          pair.append(h("dt", null, k), h("dd", null, v));
          facts.append(pair);
        }
        card.append(facts);

        const price = h("dl", "rb-price");
        for (const [k, v, cls] of [["Fare", dollars(props.price.fare), ""], ["Taxes and fees", dollars(props.price.taxes), ""], ["Total", dollars(props.price.total), "is-total"]]) {
          const pair = h("div", cls || null);
          pair.append(h("dt", null, k), h("dd", null, v));
          price.append(pair);
        }
        card.append(price);
        if (props.previousTotal !== null) {
          card.append(h("p", "rb-why", `It was ${dollars(props.previousTotal)}: the airline raised the fare a moment ago.`));
        }
        card.append(h("p", "rb-foot", props.payment));

        if (at.state === "frozen") {
          const sel = at.picked;
          card.append(
            h(
              "p",
              "rb-foot",
              sel && typeof sel === "object" && "total" in sel
                ? `You confirmed, at ${dollars(Number(/** @type {{ total: number }} */ (sel).total))}.`
                : typeof sel === "string" ? `You asked to change the ${sel}.` : "Closed when you typed instead.",
            ),
          );
        } else {
          const actions = h("div", "rb-actions");
          const confirm = h("button", "rb-button is-primary", `Confirm and book · ${dollars(props.price.total)}`);
          confirm.type = "button";
          confirm.dataset.key = "review:confirm";
          confirm.disabled = !live || at.sending;
          // DECLARED: `confirm` carries the total on screen
          confirm.onclick = () => void ask("confirm", { total: props.price.total });
          actions.append(confirm);
          for (const what of /** @type {const} */ (["flight", "fare", "seat"])) {
            if (what === "seat" && !props.fare.seatChoice) continue;
            const b = h("button", "rb-button", `Change ${what}`);
            b.type = "button";
            b.dataset.key = `review:${what}`;
            b.disabled = !live || at.sending;
            b.onclick = () => void ask("change", what); // DECLARED
            actions.append(b);
          }
          card.append(actions);
        }
        el.append(card);
      };
      const ask = asker(el, ctx, at, draw);
      draw();
      if (ctx.state === "live") requestAnimationFrame(() => showTop(el));
      return {
        freeze(/** @type {unknown} */ selection) { at.state = "frozen"; at.picked = selection; redraw(el, draw); },
        // The airline raised the fare: the review is revised in place, and says so.
        update(/** @type {BookingReviewProps} */ next) { props = next; redraw(el, draw); },
      };
    },
  },

  booking_confirmed: {
    /**
     * @param {HTMLElement} el
     * @param {BookingConfirmedProps} props
     * @param {MountCtx} ctx
     */
    mount(el, props, ctx) {
      const card = h("div", "rb-card rb-pass");
      card.append(head("E-ticket · flight home", `${props.passenger} · booking ${props.reference}`, badge("Booked", "ok")));
      const legs = h("div", "rb-legs");
      for (const leg of props.legs) {
        const row = h("div", "rb-leg");
        row.append(h("span", "rb-code", leg.from), h("span", "rb-arrow", "→"), h("span", "rb-code", leg.to), h("span", "rb-leg-flight", leg.flight));
        legs.append(row);
      }
      card.append(legs);
      const facts = h("dl", "rb-facts rb-facts-pass");
      for (const [k, v] of [["Leaves", props.depart], ["Lands", props.arrive], ["Fare", props.fare], ["Seat", props.seat ?? "At check-in"], ["Bags", props.bags], ["Paid", dollars(props.total)]]) {
        const pair = h("div");
        pair.append(h("dt", null, k), h("dd", null, v));
        facts.append(pair);
      }
      card.append(facts);
      el.append(card);
      if (ctx.state === "live") requestAnimationFrame(() => showTop(el));
    },
  },
};

/**
 * The notices. A notice component has no `send`: it shows what the airline
 * said, and nothing in it reaches back.
 */
export const notices = {
  flight_cancelled: {
    /**
     * @param {HTMLElement} el
     * @param {FlightCancelled} p
     */
    mount(el, p) {
      const box = h("div", "rb-notice rb-notice-alert");
      box.append(h("strong", null, `${p.flight} cancelled`), h("span", null, `${p.depart} · because of ${p.reason}`));
      el.append(box);
    },
  },
  seat_confirmed: {
    /**
     * @param {HTMLElement} el
     * @param {SeatConfirmed} p
     */
    mount(el, p) {
      const box = h("div", "rb-notice rb-notice-ok");
      box.append(h("strong", null, `Seat ${p.seat} confirmed`), h("span", null, `${p.flight} · booking ${p.reference}`));
      el.append(box);
    },
  },
  ticket_issued: {
    /**
     * @param {HTMLElement} el
     * @param {TicketIssued} p
     */
    mount(el, p) {
      const box = h("div", "rb-notice rb-notice-ok");
      box.append(h("strong", null, "Ticket issued"), h("span", null, `${p.ticket} · ${p.flight} · booking ${p.reference}`));
      el.append(box);
    },
  },
};
