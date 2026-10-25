/**
 * Arrows for the SVG drawn in the browser: the architecture diagram and the
 * welcome screen's illustrations.
 *
 * Colours are never baked in. Shapes take their paint from classes, and
 * lines, arrowheads and text use currentColor, so every drawing follows the
 * light and dark schemes like the rest of the page.
 */

/** The points of an arrowhead 7 long and 8 wide, its tip at (x, y), pointing along (ux, uy). */
const tip = (x: number, y: number, ux: number, uy: number) => {
  const bx = x - ux * 7;
  const by = y - uy * 7;
  return { bx, by, points: `${x},${y} ${bx - uy * 4},${by + ux * 4} ${bx + uy * 4},${by - ux * 4}` };
};

/**
 * A straight arrow from (x1, y1) to (x2, y2), its head a polygon at the end.
 * Polygons rather than <marker>s: markers need ids, and a page can show the
 * same drawing more than once.
 */
export function Arrow({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const { bx, by, points } = tip(x2, y2, (x2 - x1) / len, (y2 - y1) / len);
  return (
    <>
      <line className="stroke-current stroke-[1.75]" x1={x1} y1={y1} x2={bx} y2={by} />
      <polygon className="fill-current" points={points} />
    </>
  );
}

/** An arrowhead alone, pointing along (ux, uy) with its tip at (x, y): for the end of a curved path. */
export function Head({ x, y, ux, uy }: { x: number; y: number; ux: number; uy: number }) {
  return <polygon className="fill-current" points={tip(x, y, ux, uy).points} />;
}
