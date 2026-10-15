/**
 * The menu bar under the header: Home, Tutorial, Lesson, Reference and Demo.
 *
 * mountChat draws the header and has no option for a menu, so this adds a bar
 * of its own just beneath it. A choice is a chat
 * message, such as "Open lesson 1.3": the header isn't a surface, so the only
 * way it can reach the server is the way typing does, and the guide answers
 * by showing what was asked for. A question waiting on screen is closed by it,
 * as typing would.
 *
 * A demo is the exception: it's a site of its own, so its item is a link that
 * opens it in a new tab, and nothing reaches the conversation.
 *
 * Each menu is a button that shows or hides its list (the disclosure pattern):
 * arrow keys move through the list, Escape closes it and returns to its
 * button, and a click elsewhere closes it.
 */

/** @typedef {import("@haikit/client").Chat} Chat */
/** @typedef {{ id: string, title: string }} Ref */
/** @typedef {{ title: string, detail: string, url: string }} Demo */
/** @typedef {{ lessons: { part: number, title: string, lessons: Ref[] }[], tutorials: { title: string, steps: Ref[] }[], reference?: { title: string, pages: Ref[] }, demos?: Demo[] }} MenuData */
/** @typedef {{ n?: string, label: string, message: string } | { label: string, detail: string, href: string }} Item */
/** @typedef {{ heading?: string, items: Item[] }} Group */
/** @typedef {{ label: string, icon: keyof typeof ICONS, groups: Group[] }} Section */

/**
 * The menu's icons, drawn like the default UI's own: 24×24 strokes in the
 * colour of the text around them.
 */
const ICONS = {
  home: "M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z",
  tutorial: "M8.5 8 4.5 12l4 4M15.5 8l4 4-4 4M13.5 5.5l-3 13",
  lesson: "M3 5.5c2.5-1 5.5-1 9 1 3.5-2 6.5-2 9-1V19c-2.5-1-5.5-1-9 1-3.5-2-6.5-2-9-1zM12 6.5V20",
  reference: "M14 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8zM14 3.5V8h4.5M9 12.5h6M9 16h6",
  demo: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM10 8.6v6.8l5.6-3.4z",
  chevron: "M6 9l6 6 6-6",
};

/**
 * An icon, hidden from assistive technology: the label beside it names it.
 * @param {keyof typeof ICONS} name
 * @param {string} className
 */
function icon(name, className) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", ICONS[name]);
  svg.append(path);
  return svg;
}

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

/**
 * @param {MenuData} data
 * @returns {Section[]}
 */
const sectionsOf = (data) => [
  { label: "Home", icon: "home", groups: [{ items: [{ label: "Welcome", message: "Show the welcome screen" }] }] },
  {
    label: "Tutorial",
    icon: "tutorial",
    // one group per tutorial; a step's number drops the second tutorial's prefix
    groups: data.tutorials.map((t) => ({
      heading: t.title,
      items: t.steps.map((s) => ({ n: s.id.replace(/^\d+-/, ""), label: s.title, message: `Open tutorial step ${s.id}` })),
    })),
  },
  {
    label: "Lesson",
    icon: "lesson",
    groups: data.lessons.map((p) => ({
      heading: `Part ${p.part}: ${p.title}`,
      items: p.lessons.map((l) => ({ n: l.id, label: l.title, message: `Open lesson ${l.id}` })),
    })),
  },
  // a server from before the reference was built in sends none
  ...(data.reference
    ? [
        {
          label: "Reference",
          icon: /** @type {const} */ ("reference"),
          groups: [
            {
              heading: data.reference.title,
              items: data.reference.pages.map((p) => ({ label: p.title, message: `Open reference page ${p.id}` })),
            },
          ],
        },
      ]
    : []),
  // a server from before the demos sends none
  ...(data.demos?.length
    ? [
        {
          label: "Demo",
          icon: /** @type {const} */ ("demo"),
          groups: [
            {
              heading: "Apps built with HaiKIT",
              items: data.demos.map((d) => ({ label: d.title, detail: d.detail, href: d.url })),
            },
          ],
        },
      ]
    : []),
];

let panels = 0;

/**
 * Add the menu bar under the header mountChat drew in `root`.
 * @param {HTMLElement} root
 * @param {Chat} chat
 * @param {MenuData} data
 */
export function mountMenu(root, chat, data) {
  const sections = sectionsOf(data);
  /** @type {{ trigger: HTMLButtonElement, panel: HTMLElement }[]} */
  const menus = [];

  const nav = h("nav", "menu");
  nav.setAttribute("aria-label", "Introduction");

  /**
   * @param {{ trigger: HTMLButtonElement, panel: HTMLElement }} menu
   * @param {boolean} open
   */
  const set = (menu, open) => {
    menu.trigger.setAttribute("aria-expanded", String(open));
    menu.panel.hidden = !open;
  };
  const closeAll = () => menus.forEach((m) => set(m, false));
  /** A list's items: buttons, and a demo's links. */
  const links = (/** @type {HTMLElement} */ panel) => /** @type {HTMLElement[]} */ ([...panel.querySelectorAll("button, a")]);

  /** @param {Extract<Item, { message: string }>} item */
  const choose = (item) => {
    // closing hides the item that has focus: hand it back to the menu's button
    const open = menus.find((m) => !m.panel.hidden);
    const refocus = open && open.panel.contains(document.activeElement) ? open.trigger : null;
    closeAll();
    refocus?.focus();
    // follow the reply in, wherever the reader had scrolled to
    const transcript = root.querySelector(".hai-transcript");
    if (transcript instanceof HTMLElement) {
      transcript.scrollTop = transcript.scrollHeight;
      transcript.dispatchEvent(new Event("scroll"));
    }
    void chat.send(item.message);
  };

  /** @param {Group[]} groups */
  const list = (groups) => {
    const frag = h("div", "menu-section");
    for (const group of groups) {
      if (group.heading) frag.append(h("p", "menu-group-heading", group.heading));
      const ul = h("ul", "menu-list");
      for (const item of group.items) {
        const li = h("li");
        if ("href" in item) {
          // A site of its own: a plain link, in a new tab. Only an https URL becomes one.
          if (!/^https:\/\//.test(item.href)) continue;
          const a = h("a", "menu-link plain menu-out");
          a.href = item.href;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.setAttribute("aria-label", `${item.label}: ${item.detail} (opens in a new tab)`);
          const words = h("span", "menu-words");
          words.append(h("span", "menu-title", item.label), h("span", "menu-detail", item.detail));
          a.append(words);
          a.onclick = () => closeAll();
          li.append(a);
        } else {
          const b = h("button", item.n ? "menu-link" : "menu-link plain");
          b.type = "button";
          if (item.n) b.append(h("span", "menu-n", item.n));
          b.append(h("span", null, item.label));
          b.onclick = () => choose(item);
          li.append(b);
        }
        ul.append(li);
      }
      frag.append(ul);
    }
    return frag;
  };

  /**
   * @param {Section} section
   * @param {HTMLElement} content
   */
  const menu = (section, content) => {
    const item = h("div", "menu-item");
    const trigger = h("button", "menu-trigger");
    trigger.type = "button";
    trigger.append(icon(section.icon, "menu-icon"), h("span", null, section.label), icon("chevron", "menu-chevron"));
    const panel = h("div", "menu-panel");
    panel.id = `menu-panel-${++panels}`;
    trigger.setAttribute("aria-controls", panel.id);
    panel.append(content);
    const m = { trigger, panel };
    menus.push(m);
    set(m, false);
    trigger.onclick = () => {
      const open = trigger.getAttribute("aria-expanded") !== "true";
      closeAll();
      set(m, open);
    };
    trigger.onkeydown = (e) => {
      if (e.key !== "ArrowDown") return;
      e.preventDefault();
      // handled: the menu's own arrow keys would otherwise move past the first item
      e.stopPropagation();
      closeAll();
      set(m, true);
      links(panel)[0]?.focus();
    };
    item.append(trigger, panel);
    return item;
  };

  for (const section of sections) nav.append(menu(section, list(section.groups)));

  nav.addEventListener("keydown", (e) => {
    const open = menus.find((m) => !m.panel.hidden);
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault(); // the drawer listens for Escape too: this one is ours
      set(open, false);
      open.trigger.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = links(open.panel);
    const at = items.indexOf(/** @type {HTMLElement} */ (document.activeElement));
    if (at < 0) return;
    e.preventDefault();
    items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  });
  document.addEventListener("click", (e) => {
    if (!nav.contains(/** @type {Node} */ (e.target))) closeAll();
  });

  // Just under the header; at the top if a later mountChat draws no header.
  const top = root.querySelector(".hai-top");
  if (top) top.after(nav);
  else root.prepend(nav);
  return nav;
}
