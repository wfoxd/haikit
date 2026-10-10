/**
 * Client halves of the surface contracts.
 *
 * These are typechecked against `src/shared/surfaces.ts` — the same module the
 * server implements. Change a prop there and this file fails `npm run
 * typecheck`, which is the entire point of the contract split.
 *
 * Everything uses textContent. Tool payloads are untrusted input.
 */

/** @typedef {import("../src/shared/surfaces.ts").Flight} Flight */

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

        const head = h("div", "c-head");
        head.append(
          h("span", "c-title", `${props.origin} → ${props.destination}`),
          h("span", "c-sub", `${props.date} · ${props.flights.length} results`),
          h("span", live ? "badge badge-live" : "badge", live ? "awaiting selection" : "resolved"),
        );

        const table = h("table", "ft");
        const headRow = h("tr");
        for (const [title, key] of COLS) {
          const th = h("th", sortKey === key ? "sorted" : null, title);
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
          const tr = h("tr", [
            live ? "selectable" : "",
            selected === f.id ? "selected" : "",
            f.stops === 0 ? "nonstop" : "",
          ].filter(Boolean).join(" "));
          tr.append(
            h("td", null, f.airline), h("td", "mono", f.id), h("td", "mono", f.depart),
            h("td", "mono", f.arrive), h("td", "mono", f.duration),
            h("td", null, stopLabel(f.stops)), h("td", "mono price", `$${f.price}`),
          );
          // DECLARED. `select` exists in the contract as a resolve action.
          if (live) tr.onclick = () => ctx.send("select", f.id);
          tbody.append(tr);
        }
        table.append(tbody);

        const foot = h("div", "c-foot");
        if (rows.length > 8) {
          const btn = h("button", "link", showAll ? "collapse" : `show all ${rows.length}`);
          btn.onclick = () => { showAll = !showAll; render(); }; // LOCAL
          foot.append(btn);
        }
        foot.append(h("span", "hint", "sort + expand are local — no model round trip"));

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
        const head = h("div", "c-head");
        head.append(
          h("span", "c-title", `${props.airline} ${props.flightId}`),
          h("span", "c-sub", "rows 20–31"),
          h("span", "badge", "display"),
        );

        const grid = h("div", "seatmap");
        for (const row of props.rows) {
          const line = h("div", "seatrow");
          line.append(h("span", "rownum mono", String(row.row)));
          row.seats.forEach((seat, i) => {
            if (i === 3) line.append(h("span", "aisle"));
            // with a highlight, only free seats of that kind stay lit
            const lit = !props.highlight || (!seat.taken && (props.highlight === "window" ? seat.window : seat.extraLegroom));
            const btn = h("button", [
              "seat", seat.taken ? "taken" : "free",
              seat.extraLegroom ? "legroom" : "", picked === seat.id ? "picked" : "",
              lit ? "" : "dim",
            ].filter(Boolean).join(" "), seat.letter);
            btn.disabled = seat.taken || state !== "live";
            btn.title = `${seat.id}${seat.extraLegroom ? " · extra legroom" : ""}${seat.window ? " · window" : ""}`;
            // DECLARED as `inform`: enriches the turn without having blocked it.
            btn.onclick = () => { picked = seat.id; render(); ctx.send("pick", { id: seat.id }); };
            line.append(btn);
          });
          grid.append(line);
        }

        const foot = h("div", "c-foot");
        foot.append(h("span", "hint", "green = extra legroom · picking a seat informs the model"));
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
     * @param {import("@haikit/core").Infer<typeof import("../src/shared/notices.ts").holdConfirmed.payload>} payload
     */
    mount(el, payload) {
      const head = h("div", "c-head");
      head.append(
        h("span", "c-title", `Fare held · ${payload.airline} ${payload.flightId}`),
        h("span", "c-sub", `${payload.date} · departs ${payload.depart} · $${payload.price}`),
      );
      const foot = h("div", "c-foot");
      foot.append(h("span", "hint", "reference"), h("span", "mono", payload.reference));
      el.append(head, foot);
    },
  },
  fare_dropped: {
    /**
     * @param {HTMLElement} el
     * @param {import("@haikit/core").Infer<typeof import("../src/shared/notices.ts").fareDropped.payload>} payload
     */
    mount(el, payload) {
      const head = h("div", "c-head");
      head.append(
        h("span", "c-title", `Fare dropped · ${payload.airline} ${payload.flightId}`),
        h("span", "c-sub", `$${payload.was} → $${payload.now}`),
      );
      el.append(head);
    },
  },
};
