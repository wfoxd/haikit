/** @typedef {import("../src/shared/surfaces.ts").Greeting} Greeting */
/** @typedef {import("@haikit/core").Infer<typeof import("../src/shared/notices.ts").postcardDelivered.payload>} Delivered */
/** @typedef {import("@haikit/core").Infer<typeof import("../src/shared/notices.ts").replyReceived.payload>} Reply */

const h = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

export const registry = {
  greeting_picker: {
    mount(el, props, ctx) {
      let scriptFilter = null;
      let state = ctx.state;
      let picked = null;

      const render = () => {
        el.replaceChildren();
        const live = state === "live" && ctx.mode === "elicit";
        // worked out from the props each time: a revision can bring a new script
        const scripts = [...new Set(props.greetings.map((g) => g.script))].sort();

        const chips = h("div", "chips");
        for (const sc of [null, ...scripts]) {
          const b = h("button", scriptFilter === sc ? "chip on" : "chip", sc ?? "all");
          b.onclick = () => { scriptFilter = sc; render(); };
          chips.append(b);
        }

        const rows = props.greetings.filter((g) => !scriptFilter || g.script === scriptFilter);
        const list = h("div", "rows");
        for (const g of rows) {
          const row = h("div", live ? "row selectable" : picked === g.code ? "row picked" : "row");

          const greeting = h("span", "greeting", g.text);
          if (g.rtl) greeting.dir = "rtl";

          row.append(greeting, h("span", "lang", g.language));
          if (live) row.onclick = () => ctx.send("choose", g.code);
          list.append(row);
        }

        el.append(chips, list);
      };

      render();
      return {
        freeze(sel) { state = "frozen"; picked = sel ?? null; render(); },
        // A revision from the server: new rows, and the filter the user chose stays.
        update(next) { props = next; render(); },
      };
    },
  },

  greeting_card: {
    mount(el, props, ctx) {
      const g = props.greeting;

      const card = h("div", "card");
      const text = h("div", "card-text", g.text);
      if (g.rtl) text.dir = "rtl";

      const meta = h("div", "card-meta", `${g.language} · ${g.script} · ${g.speakersM}M speakers`);

      const copy = h("button", "chip", "copy");
      copy.onclick = async () => {
        await navigator.clipboard?.writeText(g.text).catch(() => {});
        copy.textContent = "copied";
        ctx.send("copy", { code: g.code });
      };

      card.append(text, meta, copy);
      el.append(card);
      return {};
    },
  },
};

// The notices registry: a separate allowlist, by notice name. A notice
// component has no `send`; it shows what the server said, and nothing in it
// reaches back.
export const notices = {
  postcard_delivered: {
    /** @param {HTMLElement} el @param {Delivered} payload */
    mount(el, payload) {
      const text = h("span", "greeting", payload.text);
      text.dir = "auto"; // the greeting may read right to left
      const line = h("div", "notice-line");
      line.append(h("span", null, `Delivered to ${payload.to}: `), text, h("span", "lang", payload.reference));
      el.append(line);
    },
  },
  reply_received: {
    /** @param {HTMLElement} el @param {Reply} payload */
    mount(el, payload) {
      const line = h("div", "notice-line");
      const text = h("span", "greeting", payload.text);
      text.dir = "auto"; // the reply is in the language of the postcard
      line.append(h("span", null, `${payload.from} replied: `), text);
      el.append(line);
    },
  },
};
