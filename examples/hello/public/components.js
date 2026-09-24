/** @typedef {import("../src/shared/surfaces.ts").Greeting} Greeting */  

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
  
        const scripts = [...new Set(props.greetings.map((g) => g.script))].sort();  
  
        const render = () => {
          el.replaceChildren();                             
          const live = state === "live" && ctx.mode === "elicit";  
  
          const chips = h("div", "chips");
          for (const sc of [null, ...scripts]) {
            const b = h("button", scriptFilter === sc ? "chip on" : "chip", sc ?? "all");
            b.onclick = () => { scriptFilter = sc; render(); };  
            chips.append(b);
          }
  
          const rows = props.greetings.filter((g) => !scriptFilter || g.script === scriptFilter);
          const list = h("div", "rows");
          for (const g of rows) {
            const row = h("div", live ? "row selectable" : "row");
  
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
        };
      },
    },

    // The key must match the surface's `name` exactly. A mismatch is not a
    // crash — the client renders "unknown component: greeting_card", because
    // the registry is an allowlist and anything unlisted cannot be mounted.
    greeting_card: {
      mount(el, props, ctx) {
        const g = props.greeting;

        const card = h("div", "card");
        const text = h("div", "card-text", g.text);
        if (g.rtl) text.dir = "rtl";

        const meta = h("div", "card-meta", `${g.language} · ${g.script} · ${g.speakersM}M speakers`);

        // A display surface never parks the turn, so there is nothing to
        // resolve. `inform` adds a line to the conversation after the fact.
        const copy = h("button", "chip", "copy");
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