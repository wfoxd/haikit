/**
 * The handful of icons the default UI draws. Stroked 24×24 paths in
 * `currentColor`, so each takes the colour of the text around it.
 *
 * Built on call, never at import: the package is importable where there is no
 * DOM.
 */

const PATHS = {
  send: "M12 19V5M5.5 11.5 12 5l6.5 6.5",
  plus: "M12 5v14M5 12h14",
  panel: "M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM15 4v16",
  close: "M6 6l12 12M18 6 6 18",
  chevron: "M9 6l6 6-6 6",
  check: "M5 12.5l4.5 4.5L19 7.5",
  alert: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5v5.5M12 16.5v.01",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3.5 2",
  reply: "M5 4v7a4 4 0 0 0 4 4h10M15 11l4 4-4 4",
};

const SVG = "http://www.w3.org/2000/svg";

/** The haikit favicon, docs/haikit-logo/favicon.svg, as a data URL. Its dark
 *  tile reads on a light tab bar and a dark one alike. */
export const FAVICON = "data:image/svg+xml," + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64' role='img' aria-label='HaiKIT'><title>HaiKIT</title><rect width='64' height='64' rx='14' fill='#0F1115'/><g transform='translate(8 8) scale(0.75)'><rect x='6' y='6' width='28' height='52' rx='8' fill='#F3F2EE'/><rect x='33' y='26' width='12' height='12' fill='#F3F2EE'/><rect x='44' y='6' width='14' height='52' rx='4' fill='#FF5A1F'/></g></svg>",
);

/** An inline SVG icon, hidden from assistive technology: the text beside it, or
 *  the button's label, says what it means. */
export function icon(name, className = "hai-icon") {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", PATHS[name]);
  svg.append(path);
  return svg;
}

// The haikit mark, as filled rects: [x, y, width, height, rx, part]. The parts
// are coloured by hai.css, so the mark reverses in the dark scheme. Below about
// 32px the full mark's inner bars blur, so small sizes get the simpler one.
const MARKS = {
  full: {
    viewBox: "7 8 50 48",
    rects: [
      [7, 8, 26, 48, 7, "ink"],
      [12.5, 14.5, 15, 3, 1.5, "paper"],
      [12.5, 20.5, 9, 3, 1.5, "paper-dim"],
      [12.5, 43.5, 15, 7, 3.5, "hot"],
      [32, 28, 14, 8, 0, "ink"],
      [45, 8, 12, 15, 3, "hot"],
      [45, 25, 12, 14, 3, "hot"],
      [45, 41, 12, 15, 3, "hot"],
    ],
  },
  small: {
    viewBox: "6 6 52 52",
    rects: [
      [6, 6, 28, 52, 8, "ink"],
      [33, 26, 12, 12, 0, "ink"],
      [44, 6, 14, 52, 4, "hot"],
    ],
  },
};

/** The haikit logo mark, hidden from assistive technology like the icons. */
export function mark(size = "full", className = "hai-logo") {
  const { viewBox, rects } = MARKS[size];
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("viewBox", viewBox);
  svg.setAttribute("aria-hidden", "true");
  for (const [x, y, width, height, rx, part] of rects) {
    const rect = document.createElementNS(SVG, "rect");
    for (const [k, v] of Object.entries({ x, y, width, height, rx })) {
      if (v) rect.setAttribute(k, String(v));
    }
    rect.setAttribute("class", `hai-logo-${part}`);
    svg.append(rect);
  }
  return svg;
}
