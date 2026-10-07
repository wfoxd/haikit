/**
 * The browser half of the course's three surfaces.
 *
 * Typechecked against ../src/shared/surfaces.ts, the same contract the server
 * implements: change a prop there and this file fails `npm run typecheck`.
 *
 * Everything is built with textContent, never HTML. Tool payloads are
 * untrusted input, even when the tool is your own.
 */

import { architecture } from "./architecture.js";
import { illustration } from "./illustrations.js";
import { el } from "./svg.js";
import { logo } from "./logo.js";

/** @typedef {import("../src/shared/surfaces.ts").WelcomeProps} WelcomeProps */
/** @typedef {import("../src/shared/surfaces.ts").CourseMapProps} CourseMapProps */
/** @typedef {import("../src/shared/surfaces.ts").LessonProps} LessonProps */
/** @typedef {import("../src/shared/surfaces.ts").CheckpointProps} CheckpointProps */
/** @typedef {import("../src/shared/surfaces.ts").NextLessonProps} NextLessonProps */
/** @typedef {import("../src/shared/surfaces.ts").TutorialStepProps} TutorialStepProps */
/** @typedef {import("../src/shared/surfaces.ts").Block} Block */
/** @typedef {import("../src/shared/surfaces.ts").Step} Step */
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

/** Same estimate the server uses for the context drawer: about four characters a token. */
const tokens = (/** @type {unknown} */ value) => Math.ceil(JSON.stringify(value).length / 4);

/**
 * Inline `code`, **bold** and *italic*, as elements. Bold may hold code or
 * italics, as in **`defineSurface`**. Anything else stays text, never HTML.
 * @param {HTMLElement} el
 * @param {string} text
 * @returns {HTMLElement}
 */
function inline(el, text) {
  let at = 0;
  for (const m of text.matchAll(/(`[^`]+`)|\*\*(.+?)\*\*|\*([^*\s][^*]*?)\*/g)) {
    const i = m.index ?? 0;
    if (i > at) el.append(text.slice(at, i));
    if (m[1]) el.append(h("code", "ic", m[1].slice(1, -1)));
    else if (m[2] != null) el.append(inline(h("strong"), m[2]));
    else el.append(inline(h("em"), m[3] ?? ""));
    at = i + m[0].length;
  }
  if (at < text.length) el.append(text.slice(at));
  return el;
}

const TOKEN =
  /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(const|let|function|return|if|else|for|of|new|throw|async|await|export|import|from|type|interface|extends|true|false|null|undefined|typeof|as)\b|\b(\d[\d_]*)\b/g;

/**
 * Light syntax colouring for TypeScript and JavaScript: comments, strings,
 * keywords and numbers. Spans with textContent, so nothing is parsed as HTML.
 * @param {HTMLElement} el
 * @param {string} code
 * @param {string} lang
 */
function highlight(el, code, lang) {
  if (!["ts", "tsx", "js", "json"].includes(lang)) return void el.append(code);
  let at = 0;
  for (const m of code.matchAll(TOKEN)) {
    const i = m.index ?? 0;
    if (i > at) el.append(code.slice(at, i));
    const cls = m[1] ? "t-com" : m[2] ? "t-str" : m[3] ? "t-kw" : "t-num";
    el.append(h("span", cls, m[0]));
    at = i + m[0].length;
  }
  if (at < code.length) el.append(code.slice(at));
}

// ──────────────────────────────────────────────── lesson blocks

const LANES = /** @type {const} */ (["browser", "server", "model"]);
const LANE_NAMES = { browser: "Browser", server: "Server", model: "Model" };

/**
 * The sequence diagram. Its stepping is component-local state: the lesson
 * contract declares no action for it, so these clicks cannot reach the server.
 * @param {{ title: string, steps: Step[] }} block
 */
function sequence(block) {
  const fig = h("figure", "seq");
  fig.tabIndex = 0;
  fig.setAttribute("aria-label", `${block.title}: a sequence diagram. Use the left and right arrow keys to step through it.`);

  const top = h("div", "seq-top");
  const count = h("span", "seq-count");
  top.append(h("span", "seq-title", block.title), count);

  const lanes = h("div", "seq-lanes");
  for (const lane of LANES) lanes.append(h("span", `seq-lane seq-lane-${lane}`, LANE_NAMES[lane]));

  const list = h("ol", "seq-steps");
  const note = h("p", "seq-note");
  note.setAttribute("aria-live", "polite");

  const back = h("button", "seq-btn", "Back");
  const next = h("button", "seq-btn seq-btn-next", "Next step");
  back.type = next.type = "button";
  const controls = h("div", "seq-controls");
  controls.append(back, next);

  let current = 0;
  const rows = block.steps.map((step, i) => {
    const from = LANES.indexOf(step.from);
    const to = LANES.indexOf(step.to);
    const li = h("li", `seq-step tone-${step.tone ?? "plain"}`);
    li.style.setProperty("--a", String(Math.min(from, to)));
    li.style.setProperty("--b", String(Math.max(from, to)));

    const track = h("button", from === to ? "seq-self" : `seq-arrow ${to > from ? "to-right" : "to-left"}`);
    track.type = "button";
    track.tabIndex = -1;
    track.append(h("span", "seq-label", step.label));
    track.setAttribute("aria-label", `Step ${i + 1}: ${LANE_NAMES[step.from]} to ${LANE_NAMES[step.to]}, ${step.label}`);
    track.onclick = () => go(i);
    const lane = h("div", "seq-track");
    lane.append(track);
    li.append(h("span", "seq-n", String(i + 1)), lane);
    list.append(li);
    return li;
  });

  /** @param {number} i */
  function go(i) {
    current = Math.max(0, Math.min(block.steps.length - 1, i));
    rows.forEach((row, j) => {
      row.dataset.state = j < current ? "done" : j === current ? "current" : "todo";
    });
    count.textContent = `Step ${current + 1} of ${block.steps.length}`;
    note.replaceChildren();
    inline(note, block.steps[current].note);
    back.disabled = current === 0;
    next.disabled = current === block.steps.length - 1;
  }

  back.onclick = () => go(current - 1);
  next.onclick = () => go(current + 1);
  fig.onkeydown = (e) => {
    if (e.key === "ArrowRight") { e.preventDefault(); go(current + 1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); go(current - 1); }
  };

  fig.append(top, lanes, list, note, controls);
  go(0);
  return fig;
}

let pickers = 0;

/**
 * A working select list for a comparison: radio buttons, so a keyboard and a
 * screen reader can use it as they would any form. Choosing is local to the
 * lesson, since no action is declared for it: the line under the list shows
 * what the click would send if this were the real question.
 * @param {{ caption: string, options: { id: string, label: string, detail: string }[], more?: number | undefined }} picker
 */
function selectList(picker) {
  const box = h("fieldset", "l-picker");
  box.append(h("legend", "l-picker-caption", picker.caption));
  const group = `l-picker-${++pickers}`;
  const sends = h("p", "l-picker-sends");
  sends.setAttribute("aria-live", "polite");
  /** @param {string | null} id */
  const show = (id) => {
    sends.replaceChildren();
    if (id) sends.append("Your click sends ", h("code", "ic", id));
    else sends.append("Choose one: the click is the answer.");
  };
  for (const option of picker.options) {
    const row = h("label", "l-picker-row");
    const input = h("input");
    input.type = "radio";
    input.name = group;
    input.value = option.id;
    input.onchange = () => show(option.id);
    row.append(input, h("span", "l-picker-label", option.label), h("span", "l-picker-detail", option.detail));
    box.append(row);
  }
  if (picker.more) box.append(h("p", "l-picker-more", `and ${picker.more} more`));
  box.append(sends);
  show(null);
  return box;
}

/** @typedef {Extract<Block, { kind: "code" }>} CodeBlock */
/** @typedef {{ kind: "p", text: string } | { kind: "list", items: string[] }} Prose */

/** @param {Prose} part */
function proseEl(part) {
  if (part.kind === "p") return inline(h("p"), part.text);
  const ul = h("ul");
  for (const item of part.items) ul.append(inline(h("li"), item));
  return ul;
}

let figures = 0;

/**
 * Bring a note, or the line it explains, into view and mark it for a moment.
 * @param {string} id
 */
function reveal(id) {
  const target = document.getElementById(id);
  if (!target) return;
  target.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  target.classList.remove("flash");
  void target.getBoundingClientRect(); // restart the animation
  target.classList.add("flash");
}

/**
 * Code whose lines carry numbered notes: each number links to its note, and
 * each note links back. Highlighted a line at a time, carrying a comment that
 * spans lines from one to the next.
 * @param {HTMLElement} el
 * @param {CodeBlock} block
 * @param {string} uid
 */
function numbered(el, block, uid) {
  const marks = new Map((block.marks ?? []).map((m) => [m.line, m.n]));
  const lines = block.code.split("\n");
  let inComment = false;
  lines.forEach((text, i) => {
    const line = h("span", "l-line");
    let rest = text;
    if (inComment) {
      const end = rest.indexOf("*/");
      const upto = end < 0 ? rest.length : end + 2;
      line.append(h("span", "t-com", rest.slice(0, upto)));
      rest = rest.slice(upto);
      inComment = end < 0;
    }
    const open = rest.indexOf("/*");
    if (open >= 0 && rest.indexOf("*/", open + 2) < 0) {
      highlight(line, rest.slice(0, open), block.lang);
      line.append(h("span", "t-com", rest.slice(open)));
      inComment = true;
    } else if (rest) {
      highlight(line, rest, block.lang);
    }
    const n = marks.get(i);
    if (n != null) {
      line.id = `${uid}-line-${n}`;
      const mark = h("a", "l-mark", String(n));
      mark.href = `#${uid}-${n}`;
      mark.setAttribute("aria-label", `Note ${n}`);
      mark.onclick = (e) => {
        e.preventDefault();
        reveal(`${uid}-${n}`);
      };
      line.append(" ", mark);
    }
    el.append(line);
    if (i < lines.length - 1) el.append("\n");
  });
}

/**
 * The numbered notes under a piece of code.
 * @param {NonNullable<CodeBlock["notes"]>} notes
 * @param {string} uid
 */
function notesList(notes, uid) {
  const ol = h("ol", "l-notes");
  for (const note of notes) {
    const li = h("li", "l-note-item");
    li.id = `${uid}-${note.n}`;
    li.tabIndex = -1;
    const back = h("a", "l-mark", String(note.n));
    back.href = `#${uid}-line-${note.n}`;
    back.setAttribute("aria-label", `Show the line for note ${note.n}`);
    back.onclick = (e) => {
      e.preventDefault();
      reveal(`${uid}-line-${note.n}`);
    };
    const body = h("div", "l-note-body");
    for (const part of note.body) body.append(proseEl(part));
    li.append(back, body);
    ol.append(li);
  }
  return ol;
}

/**
 * Blocks into an element, in order. A details block folds the ones after it,
 * up to its details-end, under its summary.
 * @param {HTMLElement} parent
 * @param {Block[]} blocks
 */
function renderBlocks(parent, blocks) {
  const stack = [parent];
  for (const block of blocks) {
    const into = stack[stack.length - 1] ?? parent;
    if (block.kind === "details") {
      const fold = h("details", "l-fold");
      fold.append(inline(h("summary"), block.summary));
      into.append(fold);
      stack.push(fold);
    } else if (block.kind === "details-end") {
      if (stack.length > 1) stack.pop();
    } else {
      into.append(renderBlock(block));
    }
  }
  return parent;
}

/** @param {Exclude<Block, { kind: "details" | "details-end" }>} block */
function renderBlock(block) {
  switch (block.kind) {
    case "p":
      return inline(h("p", "l-p"), block.text);
    case "h":
      return inline(h("h3", "l-h"), block.text);
    case "list": {
      const ul = h("ul", "l-list");
      for (const item of block.items) ul.append(inline(h("li"), item));
      return ul;
    }
    case "note": {
      const labels = { look: "Look", tip: "Try it", warn: "Before you ship" };
      const aside = h("aside", `l-note l-note-${block.tone}`);
      aside.append(h("strong", "l-note-label", labels[block.tone]), inline(h("p"), block.text));
      return aside;
    }
    case "code": {
      const fig = h("figure", "l-code");
      if (block.source) {
        const src = h("figcaption", "l-source");
        src.append(h("span", "l-live", "Live source"), h("span", "l-path", block.source));
        src.title = "Read from the code this server is running, when it started";
        fig.append(src);
      }
      if (block.file) {
        const label = h("figcaption", "l-file");
        label.append(h("span", "l-file-name", block.file));
        if (block.action) label.append(inline(h("span", "l-file-action"), block.action));
        fig.append(label);
      }
      const pre = h("pre");
      const code = h("code");
      const uid = `code-${++figures}`;
      if (block.marks?.length) numbered(code, block, uid);
      else highlight(code, block.code, block.lang);
      pre.append(code);
      fig.append(pre);
      if (block.caption) fig.append(inline(h("figcaption", "l-caption"), block.caption));
      if (block.notes?.length) fig.append(notesList(block.notes, uid));
      return fig;
    }
    case "diagram": {
      const fig = h("figure", "l-diagram");
      fig.append(h("pre", null, block.text));
      if (block.caption) fig.append(h("figcaption", "l-caption", block.caption));
      return fig;
    }
    case "table": {
      const wrap = h("div", "l-table");
      const table = h("table");
      const head = h("tr");
      for (const cell of block.head) head.append(h("th", null, cell));
      table.append(h("thead"), h("tbody"));
      table.tHead?.append(head);
      for (const row of block.rows) {
        const tr = h("tr");
        for (const cell of row) tr.append(inline(h("td"), cell));
        table.tBodies[0].append(tr);
      }
      wrap.append(table);
      return wrap;
    }
    case "compare": {
      const grid = h("div", "l-compare");
      for (const side of block.sides) {
        const col = h("section", `l-side l-side-${side.tone}`);
        col.append(h("h4", null, side.title));
        if (side.picker) col.append(selectList(side.picker));
        else if (side.sample) col.append(h("pre", "l-sample", side.sample));
        col.append(inline(h("p"), side.text));
        grid.append(col);
      }
      return grid;
    }
    case "sequence":
      return sequence(block);
    case "callout": {
      const look = { note: ["look", "Note"], tip: ["tip", "Tip"], warning: ["warn", "Warning"] }[block.tone];
      const box = h("aside", `l-note l-note-${look[0]} l-callout`);
      box.append(h("strong", "l-note-label", look[1]));
      if (block.title) box.append(inline(h("p", "l-callout-title"), block.title));
      for (const part of block.body) box.append(proseEl(part));
      return box;
    }
  }
}

/** Each site's mark, drawn in the text colour: [viewBox, path, name]. */
const SITES = {
  // Octicons mark-github (MIT)
  github: [
    "0 0 16 16",
    "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z",
    "GitHub",
  ],
  // Simple Icons npm (CC0)
  npm: [
    "0 0 24 24",
    "M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C24 .786 23.214 0 22.237 0zM5.13 5.323l13.837.019-.009 13.836h-3.464l.01-10.382h-3.456L12.04 19.17H5.113z",
    "npm",
  ],
};

/**
 * A link to where HaiKIT lives. It's a plain link, not a declared action, so
 * it never reaches the conversation. Only an https URL becomes one.
 * @param {{ site: "github" | "npm", label: string, url: string }} link
 */
function siteLink(link) {
  const [viewBox, path, name] = SITES[link.site] ?? SITES.github;
  if (!/^https:\/\//.test(link.url)) return null;
  const a = h("a", "welcome-link");
  a.href = link.url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.setAttribute("aria-label", `${link.label} on ${name} (opens in a new tab)`);
  const icon = el("svg", { class: "welcome-link-icon", viewBox, "aria-hidden": "true" });
  icon.append(el("path", { d: path }));
  a.append(icon, h("span", null, link.label));
  return a;
}

/**
 * HaiKIT's tutorial as a panel: a button to start it, and its steps, each a
 * button that opens that step here. Choosing one answers the welcome screen's
 * question, through its declared `tutorial` action.
 * @param {{ title: string, lead: string, steps: { id: string, label: string, title: string }[] }} tutorial
 * @param {{ live: boolean, picked: unknown, choose: (id: string) => void }} at
 */
function tutorialPanel(tutorial, at) {
  const panel = h("section", "welcome-tutorial");
  panel.append(
    h("p", "welcome-tutorial-label", "Tutorial"),
    h("h3", "welcome-tutorial-title", tutorial.title),
    inline(h("p", "welcome-tutorial-lead"), tutorial.lead),
  );

  const steps = h("ol", "welcome-tutorial-steps");
  for (const step of tutorial.steps) {
    const b = h("button", step.id === at.picked ? "picked" : null);
    b.type = "button";
    b.disabled = !at.live;
    b.onclick = () => at.choose(step.id);
    b.append(h("span", "welcome-tutorial-n", step.id), h("span", null, step.title));
    const li = h("li");
    li.append(b);
    steps.append(li);
  }

  const start = h("button", `choice-btn welcome-tutorial-read${at.picked === "intro" ? " picked" : ""}`, "Start the tutorial");
  start.type = "button";
  start.disabled = !at.live;
  start.onclick = () => at.choose("intro");
  panel.append(steps, start);
  return panel;
}

/**
 * Scroll the transcript that holds a surface, as its reader would.
 *
 * The default UI follows the newest content while the reader is at the
 * bottom, and keeps their place once they scroll up. It tells which from the
 * transcript's scroll events, so one goes with the move. Outside a transcript
 * this does nothing.
 * @param {HTMLElement} surface the element a surface mounted into
 * @param {"top" | "bottom"} where its top (with the tool row above it), or the end
 */
function scrollTranscript(surface, where) {
  const transcript = surface.closest(".hai-transcript");
  if (!(transcript instanceof HTMLElement)) return;
  if (where === "bottom") {
    transcript.scrollTop = transcript.scrollHeight;
  } else {
    const first = surface.previousElementSibling ?? surface;
    const above = first.getBoundingClientRect().top - transcript.getBoundingClientRect().top - 16;
    if (above >= 0) return; // its top is already in view: keep following
    transcript.scrollTop += above;
  }
  transcript.dispatchEvent(new Event("scroll"));
}

// ──────────────────────────────────────────────────── registry

export const registry = {
  welcome: {
    /**
     * @param {HTMLElement} el
     * @param {WelcomeProps} props
     * @param {MountCtx} ctx
     */
    mount(el, props, ctx) {
      let state = ctx.state;
      let picked = ctx.selection; // set when mounted already answered
      let sending = false;

      const render = () => {
        const live = state === "live" && ctx.mode === "elicit";
        el.replaceChildren();

        const root = h("div", "welcome");
        const top = h("div", "welcome-top");
        const title = h("h2", "welcome-title");
        title.append(logo("welcome-logo"));
        top.append(title);
        // version 5 had one GitHub link as `source`; earlier versions had none
        const legacy = /** @type {{ source?: { label: string, url: string } }} */ (props).source;
        const links = props.links ?? (legacy ? [{ site: /** @type {const} */ ("github"), ...legacy }] : []);
        const row = h("div", "welcome-links");
        for (const link of links) {
          const a = siteLink(link);
          if (a) row.append(a);
        }
        if (row.childElementCount) top.append(row);
        root.append(top);

        const [lede, ...rest] = props.intro;
        root.append(inline(h("p", "welcome-lede"), lede));
        // Welcomes stored before versions 2 and 3 have no diagram and no
        // sections; they still render.
        if (props.architecture) root.append(architecture(props.architecture));

        for (const section of props.sections ?? []) {
          const sec = h("section", "welcome-section");
          const head = h("div", "welcome-section-head");
          const words = h("div", "welcome-section-words");
          words.append(h("h3", "welcome-section-title", section.title), h("p", "welcome-section-lead", section.lead));
          head.append(words);
          // version 3 sections have no image
          const picture = section.image ? illustration(section.image) : null;
          if (picture) head.append(picture);
          sec.append(head);
          const points = h("div", "welcome-points");
          for (const point of section.points) {
            const item = h("div", "welcome-point");
            item.append(h("h4", null, point.title), inline(h("p"), point.text));
            points.append(item);
          }
          sec.append(points);
          root.append(sec);
        }

        // The close: what this app is, and the question it asks.
        const start = h("div", "welcome-start");
        for (const paragraph of rest) start.append(inline(h("p", "welcome-p"), paragraph));
        const lessons = props.parts.reduce((n, p) => n + p.lessons, 0);
        const minutes = props.parts.reduce((n, p) => n + p.minutes, 0);
        start.append(h("p", "welcome-meta", `${props.parts.length} parts, ${lessons} lessons, about ${minutes} minutes`));

        // The two buttons are this screen's question. Answering sends the
        // declared `begin` action, and the guide takes it from there.
        // Every choice here answers the screen's question: `begin` for the
        // two buttons, `tutorial` for a page of the tutorial.
        /**
         * @param {"begin" | "tutorial"} action
         * @param {string} value
         */
        const pick = async (action, value) => {
          sending = true;
          picked = value;
          render();
          // follow again, so the reply and what it shows stream into view
          scrollTranscript(el, "bottom");
          await ctx.send(action, value);
          sending = false;
          if (state === "live") { picked = undefined; render(); } // refused: stays live
        };

        const choices = [
          { value: "first-lesson", label: `Start with lesson ${props.first.id}`, cls: "choice-btn primary" },
          { value: "course-map", label: "See the course map", cls: "choice-btn" },
        ];
        const actions = h("div", "welcome-actions");
        for (const choice of choices) {
          const b = h("button", `${choice.cls}${choice.value === picked ? " picked" : ""}`, choice.label);
          b.type = "button";
          b.disabled = !live || sending;
          b.onclick = () => void pick("begin", choice.value);
          actions.append(b);
        }
        start.append(actions);

        if (!live && state === "frozen") {
          const done =
            picked === "first-lesson" ? `You started with lesson ${props.first.id}.`
            : picked === "course-map" ? "You opened the course map."
            : picked === "intro" ? "You started the tutorial."
            : typeof picked === "string" ? `You opened step ${picked} of the tutorial.`
            : "Closed when you typed instead of choosing.";
          start.append(h("p", "welcome-closed", done));
        }
        // The close: where to begin here, beside the tutorial for building
        // your own. Version 7 linked out to it, and earlier versions had none.
        const close = h("div", "welcome-close");
        close.append(start);
        const steps = props.tutorial?.steps ?? [];
        if (props.tutorial && steps.every((st) => typeof st.id === "string")) {
          close.append(
            tutorialPanel(props.tutorial, { live: live && !sending, picked, choose: (id) => void pick("tutorial", id) }),
          );
        }
        root.append(close);
        el.append(root);
      };

      render();
      // Taller than the window, it would open on its last lines: the transcript
      // follows the newest content to the bottom. Show its top instead, once
      // the transcript has placed it.
      if (ctx.state === "live") requestAnimationFrame(() => scrollTranscript(el, "top"));
      return {
        /** @param {unknown} selection */
        freeze(selection) { state = "frozen"; picked = selection; render(); },
      };
    },
  },

  course_map: {
    /**
     * @param {HTMLElement} el
     * @param {CourseMapProps} props
     * @param {MountCtx} ctx
     */
    mount(el, props, ctx) {
      let state = ctx.state;
      let picked = /** @type {unknown} */ (ctx.selection);

      const render = () => {
        const live = state === "live" && ctx.mode === "elicit";
        const lessons = props.parts.flatMap((p) => p.lessons);
        const minutes = lessons.reduce((n, l) => n + l.minutes, 0);
        el.replaceChildren();

        const root = h("div", "map");
        const head = h("header", "map-head");
        head.append(
          h("h2", "map-title", "Course map"),
          h("p", "map-meta", `${props.parts.length} parts, ${lessons.length} lessons, about ${minutes} minutes`),
        );
        root.append(head);

        for (const part of props.parts) {
          const section = h("section", "map-part");
          const title = h("h3", "map-part-title");
          title.append(h("span", "map-part-n", `Part ${part.n}`), part.title);
          section.append(title, h("p", "map-blurb", part.blurb));

          const ol = h("ol", "map-lessons");
          for (const l of part.lessons) {
            const li = h("li");
            const row = h(live ? "button" : "div", `map-lesson${l.id === picked ? " picked" : ""}`);
            if (row instanceof HTMLButtonElement) {
              row.type = "button";
              row.onclick = () => void ctx.send("open", l.id);
            }
            row.append(
              h("span", "map-id", l.id),
              h("span", "map-ltitle", l.title),
              h("span", "map-min", `${l.minutes} min`),
              h("span", "map-sum", l.summary),
            );
            li.append(row);
            ol.append(li);
          }
          section.append(ol);
          root.append(section);
        }

        // The tutorial's pages, in the same rows: opening one is the same
        // declared `open` action. A version 1 map has no tutorial.
        if (props.tutorial) {
          const section = h("section", "map-part");
          const title = h("h3", "map-part-title");
          title.append(h("span", "map-part-n", "Tutorial"), props.tutorial.title);
          section.append(title, h("p", "map-blurb", "Build a Hello, World! app with HaiKIT, step by step, read right here."));
          const ol = h("ol", "map-lessons");
          for (const page of props.tutorial.pages) {
            const li = h("li");
            const row = h(live ? "button" : "div", `map-lesson${page.id === picked ? " picked" : ""}`);
            if (row instanceof HTMLButtonElement) {
              row.type = "button";
              row.onclick = () => void ctx.send("open", page.id);
            }
            row.append(h("span", "map-id", /^\d+$/.test(page.id) ? page.id : ""), h("span", "map-ltitle", page.title));
            li.append(row);
            ol.append(li);
          }
          section.append(ol);
          root.append(section);
        }

        // Opening this is local: the contract declares no action for it.
        const glossary = h("details", "map-glossary");
        glossary.append(h("summary", null, `Glossary, ${props.glossary.length} terms`));
        const dl = h("dl");
        for (const t of props.glossary) {
          dl.append(h("dt", null, t.term), inline(h("dd"), `${t.definition} Lesson ${t.lesson}.`));
        }
        glossary.append(dl);
        root.append(glossary);

        if (!live && state === "frozen") {
          const what =
            typeof picked !== "string" ? null
            : /\./.test(picked) ? `lesson ${picked}`
            : picked === "intro" || picked === "next-steps" ? "a page of the tutorial"
            : `step ${picked} of the tutorial`;
          root.append(h("p", "map-closed", what ? `You opened ${what}.` : "Closed when you typed instead of picking."));
        }
        el.append(root);
      };

      render();
      return {
        /** @param {unknown} selection */
        freeze(selection) {
          state = "frozen";
          picked = selection;
          render();
        },
      };
    },
  },

  lesson: {
    /**
     * @param {HTMLElement} el
     * @param {LessonProps} props
     */
    mount(el, props) {
      const article = h("article", "lesson");

      const head = h("header", "lesson-head");
      const where = h("p", "lesson-where");
      where.append(
        h("span", null, `Part ${props.part.n}: ${props.part.title}`),
        h("span", "lesson-min", `${props.minutes} min read`),
      );
      const title = h("h2", "lesson-title");
      title.append(h("span", "lesson-id", props.id), props.title);
      head.append(where, title, h("p", "lesson-summary", props.summary));

      const body = h("div", "lesson-body");
      renderBlocks(body, props.blocks);

      // The recap is the digest's own takeaways: what the model was told.
      const recap = h("footer", "lesson-recap");
      recap.append(h("h3", "recap-title", "What the model was told"));
      const ul = h("ul");
      for (const t of props.takeaways) ul.append(h("li", null, t));
      recap.append(
        ul,
        h(
          "p",
          "recap-foot",
          `Everything above this box, about ${tokens(props).toLocaleString("en")} tokens, stayed in your browser. ` +
            "The model received these lines as the lesson's digest.",
        ),
      );

      article.append(head, body, recap);
      el.append(article);
      // A lesson is display-only: nothing to freeze, nothing to send.
      return {};
    },
  },

  tutorial_step: {
    /**
     * @param {HTMLElement} el
     * @param {TutorialStepProps} props
     * @param {MountCtx} ctx
     */
    mount(el, props, ctx) {
      let state = ctx.state;
      let picked = ctx.selection; // set when mounted already answered
      let sending = false;

      // The page is drawn once: only its buttons redraw when it's answered, so
      // a long page keeps the reader's place and any fold they opened.
      const article = h("article", "lesson tutorial");
      const head = h("header", "lesson-head");
      const where = h("p", "lesson-where");
      where.append(
        h("span", null, `Tutorial: ${props.tutorial}`),
        h("span", "lesson-min", `page ${props.position.index} of ${props.position.total}`),
      );
      const title = h("h2", "lesson-title");
      if (/^\d+$/.test(props.id)) title.append(h("span", "lesson-id", props.id));
      title.append(props.title);
      head.append(where, title);
      const body = renderBlocks(h("div", "lesson-body"), props.blocks);
      const nav = h("footer", "tutorial-nav");
      article.append(head, body, nav);
      el.append(article);

      /** @param {{ id: string, title: string }} ref */
      const named = (ref) => (/^\d+$/.test(ref.id) ? `${ref.id} ${ref.title}` : ref.title);

      const drawNav = () => {
        const live = state === "live" && ctx.mode === "elicit";
        nav.replaceChildren();
        const choices = [
          props.next && { value: props.next.id, label: `Next: ${named(props.next)}`, cls: "choice-btn primary" },
          props.prev && { value: props.prev.id, label: `Previous: ${named(props.prev)}`, cls: "choice-btn" },
          { value: "course-map", label: "Course map", cls: "choice-btn" },
        ].filter((c) => !!c);
        const row = h("div", "tutorial-nav-actions");
        for (const choice of choices) {
          const b = h("button", `${choice.cls}${choice.value === picked ? " picked" : ""}`, choice.label);
          b.type = "button";
          b.disabled = !live || sending;
          b.onclick = async () => {
            sending = true;
            picked = choice.value;
            drawNav();
            scrollTranscript(el, "bottom"); // follow the next page in
            await ctx.send("go", choice.value); // the buttons are the question
            sending = false;
            if (state === "live") { picked = undefined; drawNav(); } // refused: stays live
          };
          row.append(b);
        }
        nav.append(row);
        if (!live && state === "frozen") {
          const to = [props.next, props.prev].find((p) => p?.id === picked);
          nav.append(
            h(
              "p",
              "tutorial-nav-closed",
              picked === "course-map" ? "You opened the course map."
              : to ? `You went on to ${named(to)}.`
              : "Closed when you typed instead.",
            ),
          );
        }
      };

      drawNav();
      // Longer than the window, it would open on its last lines: show its top.
      if (ctx.state === "live") requestAnimationFrame(() => scrollTranscript(el, "top"));
      return {
        /** @param {unknown} selection */
        freeze(selection) { state = "frozen"; picked = selection; drawNav(); },
      };
    },
  },

  next_lesson: {
    /**
     * @param {HTMLElement} el
     * @param {NextLessonProps} props
     * @param {MountCtx} ctx
     */
    mount(el, props, ctx) {
      let state = ctx.state;
      let picked = ctx.selection; // set when mounted already answered
      let sending = false;
      const { next } = props;

      const render = () => {
        const live = state === "live" && ctx.mode === "elicit";
        el.replaceChildren();

        const root = h("div", "next-lesson");
        const title = h("h3", "next-lesson-title");
        title.append(h("span", "next-lesson-id", next.id), next.title);
        root.append(
          h("p", "next-lesson-label", `Up next, ${next.minutes} min`),
          title,
          h("p", "next-lesson-summary", next.summary),
        );

        // The buttons are the question: the next lesson waits for this click.
        const choices = [
          { value: "next-lesson", label: `Continue to lesson ${next.id}`, cls: "choice-btn primary" },
          { value: "course-map", label: "See the course map", cls: "choice-btn" },
        ];
        const actions = h("div", "next-lesson-actions");
        for (const choice of choices) {
          const b = h("button", `${choice.cls}${choice.value === picked ? " picked" : ""}`, choice.label);
          b.type = "button";
          b.disabled = !live || sending;
          b.onclick = async () => {
            sending = true;
            picked = choice.value;
            render();
            scrollTranscript(el, "bottom"); // follow the lesson in as it streams
            await ctx.send("go", choice.value);
            sending = false;
            if (state === "live") { picked = undefined; render(); } // refused: stays live
          };
          actions.append(b);
        }
        root.append(actions);

        if (!live && state === "frozen") {
          const done =
            picked === "next-lesson" ? `You continued to lesson ${next.id}.`
            : picked === "course-map" ? "You opened the course map."
            : "Closed when you typed instead of choosing.";
          root.append(h("p", "next-lesson-closed", done));
        }
        el.append(root);
      };

      render();
      return {
        /** @param {unknown} selection */
        freeze(selection) { state = "frozen"; picked = selection; render(); },
      };
    },
  },

  // #region checkpoint-component
  checkpoint: {
    /**
     * @param {HTMLElement} el
     * @param {CheckpointProps} props
     * @param {MountCtx} ctx
     */
    mount(el, props, ctx) {
      let state = ctx.state;
      let picked = ctx.selection; // set when mounted already answered
      let sending = false;

      const render = () => {
        const live = state === "live" && ctx.mode === "elicit";
        el.replaceChildren();

        const status = live ? "Waiting for your answer" : picked ? "Answered" : "Closed without an answer";
        const head = h("header", "cp-head");
        head.append(h("span", "cp-kind", `Checkpoint ${props.lessonId}`), h("span", `cp-status${live ? " live" : ""}`, status));

        const options = h("div", "cp-options");
        for (const o of props.options) {
          const b = h("button", `cp-option${o.id === picked ? " picked" : ""}`);
          b.type = "button";
          b.disabled = !live || sending;
          b.append(h("span", "cp-letter", o.id.toUpperCase()), inline(h("span", "cp-text"), o.text));
          b.onclick = async () => {
            sending = true;
            picked = o.id;
            render();
            await ctx.send("answer", o.id); // the only channel back
            sending = false;
            if (state === "live") { picked = undefined; render(); } // refused: stays live
          };
          options.append(b);
        }

        el.append(head, inline(h("p", "cp-question"), props.question), options);
      };

      render();
      return {
        /** @param {unknown} selection */
        freeze(selection) { state = "frozen"; picked = selection; render(); },
      };
    },
  },
  // #endregion checkpoint-component
};
