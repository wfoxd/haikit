/**
 * The handful of icons the default UI draws. Stroked 24×24 paths in
 * `currentColor`, so each takes the colour of the text around it.
 *
 * Built on call, never at import: the package is importable where there is no
 * DOM.
 */

const PATHS = {
  // one line splitting in two: the dual channel
  brand: "M2.5 12H8c3.5 0 4.5-6 9-6h4.5M8 12c3.5 0 4.5 6 9 6h4.5",
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
