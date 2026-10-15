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
/** @typedef {import("@haikit/core").Infer<typeof import("../src/shared/notices.ts").flightCancelled.payload>} FlightCancelled */
/** @typedef {import("@haikit/core").Infer<typeof import("../src/shared/notices.ts").seatConfirmed.payload>} SeatConfirmed */
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
     */
    mount(el, props) {
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
        el.append(card);
      };
      draw();
      // The airline revises the card in place when it cancels the flight.
      return { update(/** @type {TripCardProps} */ next) { props = next; draw(); } };
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
};
