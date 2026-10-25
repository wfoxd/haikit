/**
 * Client halves of the surface contracts.
 *
 * These are typechecked against `src/shared/surfaces.ts` — the same module the
 * server implements. Change a prop there and this file fails `npm run
 * typecheck`, which is the entire point of the contract split.
 *
 * Everything uses textContent. Tool payloads are untrusted input. The styling
 * is Tailwind, with HaiKIT's tokens as colours from @haikit/client/tailwind.css.
 */

/** @typedef {import("../shared/surfaces.ts").Flight} Flight */

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {string | null} [className]
 * @param {string} [text]
 * @returns {HTMLElementTagNameMap[K]}
 */
const h = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

const stopLabel = (/** @type {number} */ n) => (n === 0 ? "nonstop" : n === 1 ? "1 stop" : `${n} stops`);

// a surface's header and footer, shared by the notices
const HEAD = "flex items-baseline gap-2.5 border-b border-hai-line px-3 py-2.25";
const TITLE = "font-semibold";
const SUB = "text-xs text-hai-dim";
const BADGE = "ml-auto rounded border border-hai-line px-1.5 py-0.5 font-hai-mono text-[10px] tracking-[.06em] uppercase";
const FOOT = "flex items-center gap-3 border-t border-hai-line px-3 py-1.75";
const HINT = "ml-auto text-[11px] text-hai-dim";
const MONO = "font-hai-mono text-xs";

const TH = "cursor-pointer border-b border-hai-line px-3 py-1.75 text-left text-[11px] font-medium tracking-[.05em] uppercase select-none";
const TD = "border-b border-hai-line-soft px-3 py-1.5";

/**
 * A seat's look: picked, taken, extra legroom or plain, then dimmed when a
 * highlight leaves it out. One colour of each kind per state, so no two
 * utilities compete.
 * @param {{ id: string, taken: boolean, extraLegroom: boolean }} seat
 * @param {string | null} picked
 * @param {boolean} lit
 */
const seatClass = (seat, picked, lit) => {
  const look =
    picked === seat.id ? "cursor-pointer border-hai-good bg-hai-good text-hai-on-accent enabled:hover:border-hai-accent"
    : seat.taken ? "cursor-not-allowed border-hai-line text-hai-dim/45"
    : seat.extraLegroom ? "cursor-pointer border-hai-good bg-hai-hover text-hai-fg shadow-[inset_0_0_0_1px_var(--hai-good)] enabled:hover:border-hai-accent"
    : "cursor-pointer border-hai-line bg-hai-hover text-hai-fg enabled:hover:border-hai-accent";
  return `h-6 w-6.5 rounded border font-hai-mono text-[10px] ${look}${lit ? "" : " opacity-35"}`;
};

export const registry = {
  flight_table: {
    /**
     * @param {HTMLElement} el
     * @param {{origin: string, destination: string, date: string, flights: Flight[]}} props
     * @param {{handle: string, mode: string, state: string, send: (action: string, value: unknown) => void}} ctx
     */
    mount(el, props, ctx) {
      /** @type {keyof Flight} */
      let sortKey = "departMin";
      let sortDir = 1;
      let showAll = false;
      /** @type {string | null} */
      let selected = null;
      let state = ctx.state;

      /** @type {[string, keyof Flight][]} */
      const COLS = [
        ["Airline", "airline"], ["Flight", "id"], ["Depart", "departMin"],
        ["Arrive", "arrive"], ["Duration", "durationMin"], ["Stops", "stops"], ["Price", "price"],
      ];

      const render = () => {
        el.replaceChildren();
        const live = state === "live" && ctx.mode === "elicit";

        const head = h("div", HEAD);
        head.append(
          h("span", TITLE, `${props.origin} → ${props.destination}`),
          h("span", SUB, `${props.date} · ${props.flights.length} results`),
          h("span", live ? `${BADGE} bg-hai-warn text-hai-on-accent` : `${BADGE} text-hai-dim`, live ? "awaiting selection" : "resolved"),
        );

        const table = h("table", "w-full border-collapse text-[13px]");
        const headRow = h("tr");
        for (const [title, key] of COLS) {
          const th = h("th", sortKey === key ? `${TH} text-hai-fg shadow-[inset_0_-3px_0_var(--hai-accent)]` : `${TH} text-hai-dim hover:text-hai-fg`, title);
          // LOCAL. Undeclared in the contract, so there is no channel for it to
          // reach the server even if we wanted one.
          th.onclick = () => {
            sortDir = sortKey === key ? -sortDir : 1;
            sortKey = key;
            render();
          };
          headRow.append(th);
        }
        const thead = h("thead");
        thead.append(headRow);
        table.append(thead);

        const rows = [...props.flights].sort((a, b) => {
          const x = a[sortKey], y = b[sortKey];
          return (typeof x === "string" ? x.localeCompare(String(y)) : Number(x) - Number(y)) * sortDir;
        });
        const shown = showAll ? rows : rows.slice(0, 8);

        const tbody = h("tbody");
        for (const f of shown) {
          const tr = h("tr", live ? "cursor-pointer hover:bg-hai-hover" : selected === f.id ? "bg-hai-selected" : null);
          tr.append(
            // a nonstop flight is marked down its first cell
            h("td", f.stops === 0 ? `${TD} shadow-[inset_2px_0_0_var(--hai-good)]` : TD, f.airline),
            h("td", `${TD} ${MONO}`, f.id), h("td", `${TD} ${MONO}`, f.depart),
            h("td", `${TD} ${MONO}`, f.arrive), h("td", `${TD} ${MONO}`, f.duration),
            h("td", TD, stopLabel(f.stops)), h("td", `${TD} ${MONO} font-semibold`, `$${f.price}`),
          );
          // DECLARED. `select` exists in the contract as a resolve action.
          if (live) tr.onclick = () => ctx.send("select", f.id);
          tbody.append(tr);
        }
        table.append(tbody);

        const foot = h("div", FOOT);
        if (rows.length > 8) {
          const btn = h("button", "cursor-pointer text-xs text-hai-fg underline decoration-hai-accent decoration-2 underline-offset-3", showAll ? "collapse" : `show all ${rows.length}`);
          btn.onclick = () => { showAll = !showAll; render(); }; // LOCAL
          foot.append(btn);
        }
        foot.append(h("span", HINT, "sort + expand are local — no model round trip"));

        el.append(head, table, foot);
      };

      render();
      return {
        /** @param {unknown} [sel] */
        freeze(sel) {
          state = "frozen";
          selected = typeof sel === "string" ? sel : null;
          render();
        },
        // A revision, such as the airline repricing a fare: new rows, and the
        // sort and expansion the user chose stay as they were.
        /** @param {{origin: string, destination: string, date: string, flights: Flight[]}} next */
        update(next) {
          props = next;
          render();
        },
      };
    },
  },

  seat_map: {
    /**
     * @param {HTMLElement} el
     * @param {{flightId: string, airline: string, rows: {row: number, seats: {id: string, letter: string, taken: boolean, extraLegroom: boolean, window: boolean}[]}[], highlight?: "window" | "legroom"}} props
     * @param {{handle: string, mode: string, state: string, send: (action: string, value: unknown) => void}} ctx
     */
    mount(el, props, ctx) {
      /** @type {string | null} */
      let picked = null;
      let state = ctx.state;

      const render = () => {
        el.replaceChildren();
        const head = h("div", HEAD);
        head.append(
          h("span", TITLE, `${props.airline} ${props.flightId}`),
          h("span", SUB, "rows 20–31"),
          h("span", `${BADGE} text-hai-dim`, "display"),
        );

        const grid = h("div", "flex flex-col gap-1 p-3");
        for (const row of props.rows) {
          const line = h("div", "flex items-center gap-1");
          line.append(h("span", "w-6 font-hai-mono text-[11px] text-hai-dim", String(row.row)));
          row.seats.forEach((seat, i) => {
            if (i === 3) line.append(h("span", "w-3.5"));
            // with a highlight, only free seats of that kind stay lit
            const lit = !props.highlight || (!seat.taken && (props.highlight === "window" ? seat.window : seat.extraLegroom));
            const btn = h("button", seatClass(seat, picked, lit), seat.letter);
            btn.disabled = seat.taken || state !== "live";
            btn.title = `${seat.id}${seat.extraLegroom ? " · extra legroom" : ""}${seat.window ? " · window" : ""}`;
            // DECLARED as `inform`: enriches the turn without having blocked it.
            btn.onclick = () => { picked = seat.id; render(); ctx.send("pick", { id: seat.id }); };
            line.append(btn);
          });
          grid.append(line);
        }

        const foot = h("div", FOOT);
        foot.append(h("span", HINT, "green = extra legroom · picking a seat informs the model"));
        el.append(head, grid, foot);
      };

      render();
      return {
        freeze() { state = "frozen"; render(); },
        // Revised in place (highlight_seats): the new props, drawn over what
        // the user did here. A seat they picked stays picked.
        /** @param {typeof props} next */
        update(next) { props = next; render(); },
      };
    },
  },
};

/**
 * Client halves of the notice contracts, typechecked against
 * `src/shared/notices.ts` like the surfaces above. A notice component has no
 * `send`: it shows what the server said, and nothing in it reaches back.
 */
export const notices = {
  hold_confirmed: {
    /**
     * @param {HTMLElement} el
     * @param {import("@haikit/core").Infer<typeof import("../shared/notices.ts").holdConfirmed.payload>} payload
     */
    mount(el, payload) {
      const head = h("div", HEAD);
      head.append(
        h("span", TITLE, `Fare held · ${payload.airline} ${payload.flightId}`),
        h("span", SUB, `${payload.date} · departs ${payload.depart} · $${payload.price}`),
      );
      const foot = h("div", FOOT);
      foot.append(h("span", HINT, "reference"), h("span", MONO, payload.reference));
      el.append(head, foot);
    },
  },
  fare_dropped: {
    /**
     * @param {HTMLElement} el
     * @param {import("@haikit/core").Infer<typeof import("../shared/notices.ts").fareDropped.payload>} payload
     */
    mount(el, payload) {
      const head = h("div", HEAD);
      head.append(
        h("span", TITLE, `Fare dropped · ${payload.airline} ${payload.flightId}`),
        h("span", SUB, `$${payload.was} → $${payload.now}`),
      );
      el.append(head);
    },
  },
};
