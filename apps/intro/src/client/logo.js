/**
 * The HaiKIT logo: the mark and the wordmark, side by side.
 *
 * The artwork is haikit's own, docs/haikit-logo/haikit-logo.svg in the haikit
 * repository, copied here so this app stays self-contained. Its colours are not
 * baked in: each part gets a class, and styles.css fills them from hai.css's
 * logo tokens, so the logo reverses in the dark scheme like the one in the
 * header does.
 */

const SVG = "http://www.w3.org/2000/svg";

const VIEW_BOX = "7 8 209.57 48";

// [x, y, width, height, rx, part]
const MARK = [
  [7, 8, 26, 48, 7, "ink"],
  [12.5, 14.5, 15, 3, 1.5, "paper"],
  [12.5, 20.5, 9, 3, 1.5, "paper-dim"],
  [12.5, 43.5, 15, 7, 3.5, "hot"],
  [32, 28, 14, 8, 0, "ink"],
  [45, 8, 12, 15, 3, "hot"],
  [45, 25, 12, 14, 3, "hot"],
  [45, 41, 12, 15, 3, "hot"],
];

const WORDMARK =
  "M80.388 47.62V16.38H86.592V31.252L83.798 29.25H101.882L99.088 31.252V16.38H105.292V47.62H99.088V32.572L101.882 34.552H83.798L86.592 32.572V47.62ZM116.6 48.147999999999996Q112.926 48.147999999999996 110.649 46.45399999999999Q108.372 44.76 108.372 41.724Q108.372 38.644 110.297 36.93899999999999Q112.22200000000001 35.233999999999995 116.072 34.464L123.772 32.946Q123.772 30.548 122.68299999999999 29.338Q121.594 28.128 119.504 28.128Q117.546 28.128 116.435 29.03Q115.324 29.932 114.95 31.647999999999996L108.768 31.362Q109.45 27.555999999999997 112.233 25.554Q115.016 23.552 119.504 23.552Q124.652 23.552 127.27000000000001 26.070999999999998Q129.888 28.59 129.888 33.364V41.658Q129.888 42.626 130.21800000000002 42.967Q130.548 43.308 131.208 43.308H131.912V47.62Q131.626 47.708 130.988 47.774Q130.35 47.839999999999996 129.712 47.839999999999996Q128.282 47.839999999999996 127.105 47.367Q125.928 46.894 125.246 45.727999999999994Q124.564 44.562 124.564 42.471999999999994L125.092 42.867999999999995Q124.696 44.43 123.55199999999999 45.629Q122.408 46.827999999999996 120.637 47.488Q118.866 48.147999999999996 116.6 48.147999999999996ZM117.964 43.836Q119.724 43.836 121.022 43.143Q122.32000000000001 42.449999999999996 123.046 41.17399999999999Q123.772 39.897999999999996 123.772 38.16V36.928L118.052 38.116Q116.31400000000001 38.467999999999996 115.5 39.215999999999994Q114.686 39.964 114.686 41.152Q114.686 42.428 115.533 43.132Q116.38 43.836 117.964 43.836ZM133.54 47.62V24.08H139.656V47.62ZM133.43 21.066V15.918H139.76600000000002V21.066ZM149.28323974609376 38.186431152343744V31.63914306640625L161.42715380859374 16.38H167.0240107421875ZM145.1119892578125 47.62V16.38H149.72323974609375V47.62ZM161.97276025390624 47.62 152.01121826171874 32.220026855468745 155.17925048828124 29.06960107421875 167.37600537109375 47.62ZM170.71999462890622 47.62V43.27276025390625H178.18237475585937V20.727239746093748H170.71999462890622V16.38H190.25600537109372V20.727239746093748H182.7936252441406V43.27276025390625H190.25600537109372V47.62ZM202.82237475585936 47.62V20.727239746093748H193.68799999999996V16.38H216.56799999999996V20.727239746093748H207.4336252441406V47.62Z";

/** The logo's width over its height, for placing it at a given height. */
export const LOGO_RATIO = 209.57 / 48;

/** @param {Element} parent */
function draw(parent) {
  for (const [x, y, width, height, rx, part] of MARK) {
    const rect = document.createElementNS(SVG, "rect");
    for (const [k, v] of Object.entries({ x, y, width, height, rx })) {
      if (v) rect.setAttribute(k, String(v));
    }
    rect.setAttribute("class", `brand-${part}`);
    parent.append(rect);
  }
  const word = document.createElementNS(SVG, "path");
  word.setAttribute("class", "brand-ink");
  word.setAttribute("d", WORDMARK);
  parent.append(word);
}

/**
 * The full logo as an inline SVG, named "HaiKIT" for assistive technology.
 * @param {string} className
 * @returns {SVGSVGElement}
 */
export function logo(className) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("viewBox", VIEW_BOX);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "HaiKIT");
  const title = document.createElementNS(SVG, "title");
  title.textContent = "HaiKIT";
  svg.append(title);
  draw(svg);
  return svg;
}

/**
 * The logo inside an SVG being built, its top left at (x, y) and `height`
 * tall. The enclosing SVG's label speaks for it.
 * @param {Element} parent
 * @param {number} x
 * @param {number} y
 * @param {number} height
 */
export function logoInto(parent, x, y, height) {
  const g = document.createElementNS(SVG, "g");
  g.setAttribute("transform", `translate(${x} ${y}) scale(${height / 48}) translate(-7 -8)`);
  draw(g);
  parent.append(g);
}
