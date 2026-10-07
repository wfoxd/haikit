/**
 * The welcome screen's illustrations, one per section. Each draws the
 * mechanism its section claims rather than decorating it:
 *
 *   payload-split   one tool call, full data to the app, a digest to the LLM
 *   llm-flow        the LLM picks a tool, and asking is a component that waits
 *   contract-split  one contract, a server half and a browser half, both checked
 *
 * Drawn 360 units wide, so their labels stay readable from a phone to a wide
 * card. Paint comes from styles.css (the .ill-* rules), so they follow the
 * light and dark schemes.
 */

import { arrow, el, head } from "./svg.js";

const W = 360;

/** @param {number} h */
const canvas = (h) => el("svg", { class: "ill", viewBox: `0 0 ${W} ${h}` });

/**
 * A rounded card.
 * @param {string} cls
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 */
const card = (cls, x, y, w, h) => el("rect", { class: cls, x, y, width: w, height: h, rx: 10 });

/**
 * @param {string} cls
 * @param {number} x
 * @param {number} y
 * @param {string} value
 * @param {"start" | "middle" | "end"} [anchor]
 */
const text = (cls, x, y, value, anchor = "start") => el("text", { class: cls, x, y, "text-anchor": anchor }, value);

/**
 * Lines standing in for rows of content.
 * @param {Element} parent
 * @param {string} cls
 * @param {number} x
 * @param {number} y
 * @param {number[]} lengths
 * @param {number} [gap]
 */
function rows(parent, cls, x, y, lengths, gap = 8) {
  lengths.forEach((len, i) => parent.append(el("line", { class: cls, x1: x, y1: y + i * gap, x2: x + len, y2: y + i * gap })));
}

/** One tool call: the full data goes to the app, a short digest to the LLM. */
function payloadSplit() {
  const svg = canvas(186);

  svg.append(card("ill-card-strong", 110, 4, 140, 30), text("ill-label", 180, 24, "one tool call", "middle"));

  // the call forks: data one way, digest the other
  const toApp = el("g", { class: "ill-ui" });
  toApp.append(el("path", { class: "ill-wire", d: "M180 34 C180 48 89 44 89 59" }));
  head(toApp, 89, 60, 0, 1);
  const toLlm = el("g", { class: "ill-model" });
  toLlm.append(el("path", { class: "ill-wire", d: "M180 34 C180 48 276 44 276 59" }));
  head(toLlm, 276, 60, 0, 1);
  svg.append(toApp, toLlm);

  const data = el("g", { class: "ill-ui" });
  data.append(
    card("ill-card-ui", 4, 60, 170, 84),
    text("ill-label", 16, 82, "Full data"),
    text("ill-sub", 16, 98, "to your app"),
  );
  rows(data, "ill-row", 16, 112, [134, 112, 128, 100]);
  const digest = el("g", { class: "ill-model" });
  digest.append(
    card("ill-card-model", 196, 60, 160, 58),
    text("ill-label", 208, 82, "Digest"),
    text("ill-sub", 208, 98, "to the LLM"),
  );
  rows(digest, "ill-row", 208, 108, [70]);
  svg.append(data, digest);

  // the share: 97 parts browser to 3 parts model
  svg.append(
    el("rect", { class: "ill-bar-ui", x: 4, y: 156, width: 341, height: 8, rx: 4 }),
    el("rect", { class: "ill-bar-model", x: 347, y: 156, width: 9, height: 8, rx: 3 }),
    text("ill-sub", 4, 182, "97% of the data never reaches the model"),
  );
  return svg;
}

/** The LLM picks the next tool; asking is a component that waits for a click. */
function llmFlow() {
  const svg = canvas(186);

  const llm = el("g", { class: "ill-model" });
  llm.append(card("ill-card-model", 4, 64, 72, 48), text("ill-label", 40, 93, "LLM", "middle"));
  svg.append(llm);

  // three tools it could call; this time it asks
  const tools = [
    { y: 14, name: "search", chosen: false },
    { y: 74, name: "compare", chosen: false },
    { y: 134, name: "ask you", chosen: true },
  ];
  for (const t of tools) {
    const g = el("g", { class: t.chosen ? "ill-model" : "ill-dim" });
    const cy = t.y + 14;
    g.append(el("path", { class: t.chosen ? "ill-wire" : "ill-wire ill-wire-faint", d: `M76 88 C96 88 96 ${cy} 113 ${cy}` }));
    if (t.chosen) head(g, 116, cy, 1, 0);
    g.append(
      card(t.chosen ? "ill-card-model" : "ill-card", 116, t.y, 96, 28),
      text(t.chosen ? "ill-label" : "ill-sub", 164, t.y + 19, t.name, "middle"),
    );
    svg.append(g);
  }

  // the question, as a component: one option picked
  const ask = el("g", { class: "ill-model" });
  arrow(ask, 212, 148, 238, 122);
  svg.append(ask);
  svg.append(card("ill-card-strong", 240, 44, 116, 118), text("ill-label", 252, 68, "Which one?"));
  [80, 102, 124].forEach((y, i) =>
    svg.append(el("rect", { class: i === 1 ? "ill-option-picked" : "ill-option", x: 252, y, width: 92, height: 16, rx: 4 })),
  );
  svg.append(el("path", { class: "ill-cursor", d: "M318 104 L318 120 L322 116 L325 123 L328 122 L325 115 L330 115 Z" }));

  const wait = el("g", { class: "ill-wait" });
  wait.append(el("circle", { class: "ill-dot", cx: 246, cy: 177, r: 4 }), text("ill-sub-strong", 256, 182, "waits for you"));
  svg.append(wait);
  return svg;
}

/** One contract, implemented twice, and TypeScript holds both halves to it. */
function contractSplit() {
  const svg = canvas(186);

  svg.append(
    card("ill-card-strong", 100, 4, 160, 52),
    text("ill-label", 180, 26, "one contract", "middle"),
    text("ill-code", 180, 45, "defineSurface()", "middle"),
  );

  const halves = [
    { x: 4, cls: "ill-model", fill: "ill-card-model", name: "server half", from: 150, to: 79 },
    { x: 206, cls: "ill-ui", fill: "ill-card-ui", name: "browser half", from: 210, to: 281 },
  ];
  for (const half of halves) {
    const g = el("g", { class: "ill-ink" });
    arrow(g, half.from, 56, half.to, 102);
    svg.append(g);

    const box = el("g", { class: half.cls });
    box.append(card(half.fill, half.x, 104, 150, 58), text("ill-label", half.x + 14, 128, half.name));
    rows(box, "ill-row", half.x + 14, 142, [96, 64], 9);
    svg.append(box);

    // a check on each line: the compiler holds this half to the contract
    const mx = (half.from + half.to) / 2;
    const check = el("g", { class: "ill-ok" });
    check.append(
      el("circle", { class: "ill-check-dot", cx: mx, cy: 79, r: 9 }),
      el("path", { class: "ill-check", d: `M${mx - 4} 79 l3 3 l5 -6` }),
    );
    svg.append(check);
  }

  svg.append(text("ill-sub", 180, 182, "TypeScript checks both halves", "middle"));
  return svg;
}

const DRAW = { "payload-split": payloadSplit, "llm-flow": llmFlow, "contract-split": contractSplit };

/**
 * A section's illustration as a figure, or null for one this page can't draw.
 * @param {{ kind: string, alt: string }} image
 */
export function illustration(image) {
  const draw = DRAW[/** @type {keyof typeof DRAW} */ (image.kind)];
  if (!draw) return null;
  const svg = draw();
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", image.alt);
  const figure = document.createElement("figure");
  figure.className = "welcome-ill";
  figure.append(svg);
  return figure;
}
