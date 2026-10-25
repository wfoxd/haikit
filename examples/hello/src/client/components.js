/** @typedef {import("../shared/surfaces.ts").Greeting} Greeting */

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

export const registry = {
  /** @type {import("@haikit/client").ComponentDef<{ greetings: Greeting[] }>} */
  greeting_picker: {
    mount(el, props, ctx) {
      let scriptFilter = null;
      let state = ctx.state;
      let picked = null;

      const scripts = [...new Set(props.greetings.map((g) => g.script))].sort();

      const render = () => {
        el.replaceChildren();
        const live = state === "live" && ctx.mode === "elicit";

        const chips = h("div", "flex flex-wrap gap-1.5 px-3 pt-2.25 pb-1");
        for (const sc of [null, ...scripts]) {
          const b = h("button", scriptFilter === sc ? CHIP_ON : CHIP_OFF, sc ?? "all");
          b.onclick = () => { scriptFilter = sc; render(); };
          chips.append(b);
        }

        const rows = props.greetings.filter((g) => !scriptFilter || g.script === scriptFilter);
        const list = h("div", "pt-1 pb-2");
        for (const g of rows) {
          const row = h("div", live ? `${ROW} cursor-pointer hover:bg-hai-hover` : ROW);

          const greeting = h("span", "text-[15px]", g.text);
          if (g.rtl) greeting.dir = "rtl";

          row.append(greeting, h("span", "font-hai-mono text-xs text-hai-dim", g.language));
          if (live) row.onclick = () => ctx.send("choose", g.code);
          list.append(row);
        }

        el.append(chips, list);
      };

      render();
      return {
        freeze(sel) { state = "frozen"; picked = sel ?? null; render(); },
      };
    },
  },

  // The key must match the surface's `name` exactly. A mismatch is not a
  // crash — the client renders "unknown component: greeting_card", because
  // the registry is an allowlist and anything unlisted cannot be mounted.
  /** @type {import("@haikit/client").ComponentDef<{ greeting: Greeting }>} */
  greeting_card: {
    mount(el, props, ctx) {
      const g = props.greeting;

      const card = h("div", "flex flex-col items-start gap-2 px-3.5 py-4");
      const text = h("div", "text-[28px] leading-tight", g.text);
      if (g.rtl) text.dir = "rtl";

      const meta = h("div", "font-hai-mono text-xs text-hai-dim", `${g.language} · ${g.script} · ${g.speakersM}M speakers`);

      // A display surface never parks the turn, so there is nothing to
      // resolve. `inform` adds a line to the conversation after the fact.
      const copy = h("button", CHIP_OFF, "copy");
      copy.onclick = async () => {
        await navigator.clipboard?.writeText(g.text).catch(() => {});
        copy.textContent = "copied";
        ctx.send("copy", { code: g.code });
      };

      card.append(text, meta, copy);
      el.append(card);

      // No `freeze` — a display surface is never frozen, because it was
      // never holding the turn open in the first place.
      return {};
    },
  },
};
