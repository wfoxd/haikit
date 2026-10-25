/** @typedef {import("../shared/surfaces.ts").Greeting} Greeting */
/** @typedef {import("@haikit/core").Infer<typeof import("../shared/notices.ts").postcardDelivered.payload>} Delivered */
/** @typedef {import("@haikit/core").Infer<typeof import("../shared/notices.ts").replyReceived.payload>} Reply */

const h = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

// HaiKIT's tokens as Tailwind colours, from @haikit/client/tailwind.css
const CHIP = "cursor-pointer rounded-full border px-2.5 py-0.75 font-hai-mono text-[11px]";
const CHIP_ON = `${CHIP} border-hai-accent bg-hai-accent text-hai-on-accent`;
const CHIP_OFF = `${CHIP} border-hai-line text-hai-dim hover:border-hai-accent hover:text-hai-fg`;
const ROW = "grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] items-baseline gap-3 border-b border-hai-line-soft px-3 py-1.75";
const LANG = "font-hai-mono text-xs text-hai-dim";
const NOTICE = "flex flex-wrap items-baseline gap-x-2.5 gap-y-1.5 px-3 py-2.25";

export const registry = {
  /** @type {import("@haikit/client").ComponentDef<{ greetings: Greeting[] }>} */
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

        const chips = h("div", "flex flex-wrap gap-1.5 px-3 pt-2.25 pb-1");
        for (const sc of [null, ...scripts]) {
          const b = h("button", scriptFilter === sc ? CHIP_ON : CHIP_OFF, sc ?? "all");
          b.onclick = () => { scriptFilter = sc; render(); };
          chips.append(b);
        }

        const rows = props.greetings.filter((g) => !scriptFilter || g.script === scriptFilter);
        const list = h("div", "pt-1 pb-2");
        for (const g of rows) {
          const row = h("div", live ? `${ROW} cursor-pointer hover:bg-hai-hover` : picked === g.code ? `${ROW} bg-hai-selected` : ROW);

          const greeting = h("span", "text-[15px]", g.text);
          if (g.rtl) greeting.dir = "rtl";

          row.append(greeting, h("span", LANG, g.language));
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

  /** @type {import("@haikit/client").ComponentDef<{ greeting: Greeting }>} */
  greeting_card: {
    mount(el, props, ctx) {
      const g = props.greeting;

      const card = h("div", "flex flex-col items-start gap-2 px-3.5 py-4");
      const text = h("div", "text-[28px] leading-tight", g.text);
      if (g.rtl) text.dir = "rtl";

      const meta = h("div", LANG, `${g.language} · ${g.script} · ${g.speakersM}M speakers`);

      const copy = h("button", CHIP_OFF, "copy");
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
  /** @type {import("@haikit/client").NoticeDef<Delivered>} */
  postcard_delivered: {
    mount(el, payload) {
      const text = h("span", "text-sm", payload.text);
      text.dir = "auto"; // the greeting may read right to left
      const line = h("div", NOTICE);
      line.append(h("span", null, `Delivered to ${payload.to}: `), text, h("span", LANG, payload.reference));
      el.append(line);
    },
  },
  /** @type {import("@haikit/client").NoticeDef<Reply>} */
  reply_received: {
    mount(el, payload) {
      const line = h("div", NOTICE);
      const text = h("span", "text-sm", payload.text);
      text.dir = "auto"; // the reply is in the language of the postcard
      line.append(h("span", null, `${payload.from} replied: `), text);
      el.append(line);
    },
  },
};
