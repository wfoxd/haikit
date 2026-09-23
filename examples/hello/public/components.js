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
  };