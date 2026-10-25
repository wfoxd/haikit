/**
 * Small helpers for the SVG drawn in the browser: the architecture diagram
 * and the welcome screen's illustrations.
 *
 * Colours are never baked in. Shapes take their paint from CSS classes, and
 * lines, arrowheads and text use currentColor, so every drawing follows the
 * light and dark schemes like the rest of the page.
 */

const SVG = "http://www.w3.org/2000/svg";

/**
 * An SVG element with its attributes, and text if given.
 * @param {string} tag
 * @param {Record<string, string | number>} [attrs]
 * @param {string} [text]
 */
export function el(tag, attrs = {}, text) {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text != null) node.textContent = text;
  return node;
}

/**
 * A straight arrow from (x1, y1) to (x2, y2), its head a polygon at the end.
 * Polygons rather than <marker>s: markers need ids, and a page can show the
 * same drawing more than once.
 * @param {Element} parent
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 */
export function arrow(parent, x1, y1, x2, y2) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  const bx = x2 - ux * 7; // the head is 7 long and 8 wide
  const by = y2 - uy * 7;
  parent.append(
    el("line", { x1, y1, x2: bx, y2: by }),
    el("polygon", { points: `${x2},${y2} ${bx - uy * 4},${by + ux * 4} ${bx + uy * 4},${by - ux * 4}` }),
  );
}

/**
 * An arrowhead alone, pointing along (ux, uy) with its tip at (x, y): for the
 * end of a curved path.
 * @param {Element} parent
 * @param {number} x
 * @param {number} y
 * @param {number} ux
 * @param {number} uy
 */
export function head(parent, x, y, ux, uy) {
  const bx = x - ux * 7;
  const by = y - uy * 7;
  parent.append(el("polygon", { points: `${x},${y} ${bx - uy * 4},${by + ux * 4} ${bx + uy * 4},${by - ux * 4}` }));
}
