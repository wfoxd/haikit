/**
 * The demo's components, drawn small in the welcome's walkthrough: a trip
 * card, a list to pick from, a seat map, a question with a few answers, a
 * boarding pass. Each is a picture of what the demo shows, not the component:
 * nothing in it can be clicked, and it never reaches the conversation.
 *
 * Each sits under the row the default UI draws over a surface, with the tool
 * that rendered it, and "waits for you" on a tool that asks. A screen reader
 * hears each as a group named for what it is, then its words; the seat map's
 * grid is a picture, so it hears which seat was picked instead.
 */

/** @typedef {import("../src/shared/surfaces.ts").WelcomeProps} WelcomeProps */
/** @typedef {Exclude<WelcomeProps["example"]["steps"][number]["scene"][number], { from: string }>} MiniLine */
/** @typedef {{ k: string, v: string, moved?: boolean }} Fact */

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

/** What each kind is, for a screen reader. */
const NAMES = {
  trip: "trip card",
  options: "list of options",
  seats: "seat map",
  choices: "question",
  pass: "boarding pass",
};

/** "Seat 11F": the seat map's letters, the aisle between C and D. */
const LETTERS = ["A", "B", "C", "D", "E", "F"];

/**
 * A card's head: its title and the line under it, and a badge.
 * @param {MiniLine} c
 */
function head(c) {
  const top = h("div", "mini-head");
  const words = h("div", "mini-head-words");
  words.append(h("p", "mini-title", c.title), h("p", "mini-sub", c.sub));
  top.append(words);
  if (c.badge) top.append(h("span", `mini-badge ${c.badge.tone}`, c.badge.text));
  return top;
}

/**
 * Facts as a row of labelled values; one that just changed stands out.
 * @param {Fact[]} facts
 */
function factList(facts) {
  const dl = h("dl", "mini-facts");
  for (const f of facts) {
    const pair = h("div", f.moved ? "is-moved" : null);
    pair.append(h("dt", null, f.k), h("dd", null, f.v));
    dl.append(pair);
  }
  return dl;
}

/** @param {Extract<MiniLine, { ui: "trip" }>} c */
function trip(c) {
  const route = h("div", "mini-route");
  for (const [i, stop] of [c.from, c.to].entries()) {
    if (i) route.append(h("span", "mini-arrow", "→"));
    const end = h("div", "mini-stop");
    end.append(h("span", "mini-code", stop.code), h("span", "mini-city", `${stop.city} · ${stop.time}`));
    route.append(end);
  }
  const parts = [route, factList(c.facts)];
  if (c.why) parts.push(h("p", "mini-why", c.why));
  return parts;
}

/** @param {Extract<MiniLine, { ui: "options" }>} c */
function options(c) {
  const parts = [];
  if (c.chips) {
    const chips = h("div", "mini-chips");
    for (const chip of c.chips) chips.append(h("span", chip.on ? "mini-chip is-on" : "mini-chip", chip.label));
    parts.push(chips);
  }
  const list = h("ol", "mini-list");
  for (const r of c.rows) {
    const row = h("li", r.picked ? "mini-option is-picked" : "mini-option");
    const what = h("span", "mini-what");
    what.append(h("span", "mini-flights", r.flights), h("span", "mini-detail", `${r.depart} → ${r.arrive} · ${r.detail}`));
    const cost = h("span", "mini-cost");
    cost.append(h("span", r.free ? "mini-fare is-free" : "mini-fare", r.fare), h("span", r.low ? "mini-left is-low" : "mini-left", r.left));
    row.append(what, cost);
    if (r.picked) row.append(h("span", "welcome-sr", " (clicked)"));
    list.append(row);
  }
  parts.push(list);
  if (c.more) parts.push(h("p", "mini-more", c.more));
  return parts;
}

/** @param {Extract<MiniLine, { ui: "seats" }>} c */
function seats(c) {
  const grid = h("div", "mini-seats");
  grid.setAttribute("aria-hidden", "true"); // a picture: the line after it says what was picked
  /** @type {string | null} */
  let picked = null;
  for (const row of c.rows) {
    const line = h("div", "mini-seat-row");
    line.append(h("span", "mini-rownum", String(row.n)));
    [...row.seats].forEach((s, i) => {
      if (i === 3) line.append(h("span", "mini-aisle"));
      const cls = { ".": "", L: "is-legroom", x: "is-taken", "*": "is-picked" }[s] ?? "";
      line.append(h("span", `mini-seat ${cls}`.trim(), s === "x" ? "" : LETTERS[i]));
      if (s === "*") picked = `${row.n}${LETTERS[i]}`;
    });
    grid.append(line);
  }
  const parts = [grid];
  if (picked) parts.push(h("p", "welcome-sr", `Seat ${picked} picked; grey seats are taken.`));
  parts.push(h("p", "mini-foot", c.foot));
  return parts;
}

/** @param {Extract<MiniLine, { ui: "choices" }>} c */
function choices(c) {
  const list = h("ul", "mini-choices");
  for (const choice of c.choices) {
    const li = h("li", choice.picked ? "mini-choice is-picked" : "mini-choice");
    li.append(h("span", "mini-choice-title", choice.title), h("span", "mini-detail", choice.detail));
    if (choice.picked) li.append(h("span", "welcome-sr", " (clicked)"));
    list.append(li);
  }
  return [list];
}

/** @param {Extract<MiniLine, { ui: "pass" }>} c */
function pass(c) {
  const legs = h("div", "mini-legs");
  for (const leg of c.legs) {
    const row = h("div", "mini-route");
    row.append(h("span", "mini-code", leg.from), h("span", "mini-arrow", "→"), h("span", "mini-code", leg.to), h("span", "mini-leg-flight", leg.flight));
    legs.append(row);
  }
  const facts = factList(c.facts);
  facts.classList.add("mini-facts-pass");
  const parts = [legs, facts];
  if (c.why) parts.push(h("p", "mini-why", c.why));
  if (c.foot) parts.push(h("p", "mini-foot", c.foot));
  return parts;
}

/**
 * One of the demo's components, drawn small under its tool's row.
 * @param {MiniLine} c
 */
export function mini(c) {
  const box = h("div", `mini mini-${c.ui}`);
  box.setAttribute("role", "group");
  box.setAttribute("aria-label", `Rebook's ${NAMES[c.ui]}, from its ${c.tool} tool${c.asks ? ", waiting for a click" : ""}`);

  const bar = h("div", "mini-bar");
  bar.setAttribute("aria-hidden", "true"); // the group's name says the same
  bar.append(h("span", "mini-tool", c.tool), h("span", c.asks ? "mini-state asks" : "mini-state", c.asks ? "waits for you" : "✓"));

  const card = h("div", "mini-card");
  card.append(head(c));
  if (c.ui === "trip") card.append(...trip(c));
  else if (c.ui === "options") card.append(...options(c));
  else if (c.ui === "seats") card.append(...seats(c));
  else if (c.ui === "choices") card.append(...choices(c));
  else card.append(...pass(c));

  box.append(bar, card);
  return box;
}
