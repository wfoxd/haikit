/**
 * The welcome screen's architecture diagram: the LLM, HaiKIT and your app,
 * and the labelled arrows between them.
 *
 * Drawn twice from the same data: left to right for a wide card, top to bottom
 * for a narrow one, and styles.css shows whichever fits its container. One
 * drawing scaled down to a phone would shrink its labels past reading.
 *
 * Colours come from CSS through currentColor, so the diagram follows light,
 * dark and a pinned scheme. The drawing helpers are in svg.js.
 */

import { LOGO_RATIO, logoInto } from "./logo.js";
import { arrow, el } from "./svg.js";

/** @typedef {import("../src/shared/surfaces.ts").WelcomeProps["architecture"]} Architecture */
/** @typedef {Architecture["nodes"][number]} Node */
/** @typedef {Architecture["links"][number][number]} Arrow */

/**
 * A box: its name (or, for HaiKIT, the logo) and its role.
 * @param {Element} svg
 * @param {Node} node
 * @param {{ x: number, y: number, w: number, h: number, textX: number, nameY: number, roleY: number, anchor: string }} at
 */
function box(svg, node, at) {
  const g = el("g", { class: node.brand ? "arch-node brand" : "arch-node" });
  g.append(el("rect", { class: "arch-box", x: at.x, y: at.y, width: at.w, height: at.h, rx: 9 }));
  if (node.brand) {
    const h = 16;
    const w = h * LOGO_RATIO;
    const left = at.anchor === "middle" ? at.textX - w / 2 : at.textX;
    logoInto(g, left, at.nameY - 13, h);
  } else {
    g.append(el("text", { class: "arch-name", x: at.textX, y: at.nameY, "text-anchor": at.anchor }, node.name));
  }
  g.append(el("text", { class: "arch-role", x: at.textX, y: at.roleY, "text-anchor": at.anchor }, node.role));
  svg.append(g);
}

/** @param {Arrow} a */
const arrowGroup = (a) => el("g", { class: `arch-arrow arch-${a.channel}` });

/**
 * Left to right: the boxes in a row, each link's arrows stacked between them.
 * @param {Architecture} arch
 */
function wide(arch) {
  const W = 600, nodeW = 116, top = 1, rowGap = 30, firstRow = 30;
  const rows = 1 + Math.max(...arch.links.flat().map((a) => a.row));
  const nodeH = firstRow * 2 + (rows - 1) * rowGap;
  const svg = el("svg", { class: "arch-wide", viewBox: `0 0 ${W} ${top + nodeH + 1}` });

  const step = (W - 2 - nodeW) / (arch.nodes.length - 1);
  const xs = arch.nodes.map((_, i) => 1 + i * step);
  const mid = top + nodeH / 2;
  arch.nodes.forEach((node, i) =>
    box(svg, node, { x: xs[i], y: top, w: nodeW, h: nodeH, textX: xs[i] + nodeW / 2, nameY: mid - 1, roleY: mid + 17, anchor: "middle" }),
  );

  arch.links.forEach((arrows, i) => {
    const left = xs[i] + nodeW + 7;
    const right = xs[i + 1] - 7;
    for (const a of arrows) {
      const y = top + firstRow + a.row * rowGap;
      const g = arrowGroup(a);
      if (a.dir === "forward") arrow(g, left, y, right, y);
      else arrow(g, right, y, left, y);
      g.append(el("text", { class: "arch-label", x: (left + right) / 2, y: y - 7, "text-anchor": "middle" }, a.label));
      svg.append(g);
    }
  });
  return svg;
}

/**
 * Top to bottom: the boxes in a column, each link's arrows listed between
 * them, pointing down (away from the LLM) or up (back to it).
 * @param {Architecture} arch
 */
function narrow(arch) {
  const W = 300, nodeH = 52, rowH = 26, pad = 6;
  const svg = el("svg", { class: "arch-narrow" });
  let y = 1;
  arch.nodes.forEach((node, i) => {
    box(svg, node, { x: 1, y, w: W - 2, h: nodeH, textX: 16, nameY: y + 22, roleY: y + 40, anchor: "start" });
    y += nodeH;
    const arrows = [...(arch.links[i] ?? [])].sort((a, b) => a.row - b.row);
    if (!arrows.length) return;
    y += pad;
    for (const a of arrows) {
      const g = arrowGroup(a);
      const [from, to] = a.dir === "forward" ? [y + 4, y + rowH - 4] : [y + rowH - 4, y + 4];
      arrow(g, 30, from, 30, to);
      g.append(el("text", { class: "arch-label", x: 44, y: y + rowH / 2 + 4 }, a.label));
      svg.append(g);
      y += rowH;
    }
    y += pad;
  });
  svg.setAttribute("viewBox", `0 0 ${W} ${y + 1}`);
  return svg;
}

/**
 * The diagram as a figure, with its caption, and its claim spoken in full to
 * readers who can't see it.
 * @param {Architecture} arch
 */
export function architecture(arch) {
  const figure = document.createElement("figure");
  figure.className = "arch";
  for (const svg of [wide(arch), narrow(arch)]) {
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `${arch.caption} ${arch.description}`);
    figure.append(svg);
  }
  const caption = document.createElement("figcaption");
  caption.textContent = arch.caption;
  figure.append(caption);
  return figure;
}
