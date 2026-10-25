/**
 * The welcome screen's architecture diagram: the LLM, HaiKIT and your app,
 * and the labelled arrows between them.
 *
 * Drawn twice from the same data: left to right for a wide card, top to bottom
 * for a narrow one, and a container query shows whichever fits. One drawing
 * scaled down to a phone would shrink its labels past reading.
 *
 * Colours come through currentColor, so the diagram follows light, dark and a
 * pinned scheme.
 */

import type { ReactNode } from "react";
import type { Architecture as Arch } from "../../shared/surfaces.ts";
import { cn } from "@/lib/utils";
import { LOGO_RATIO, LogoAt } from "./Logo.tsx";
import { Arrow as Line } from "./svg.tsx";

type Node = Arch["nodes"][number];
type Arrow = Arch["links"][number][number];
type At = { x: number; y: number; w: number; h: number; textX: number; nameY: number; roleY: number; anchor: "start" | "middle" };

/** A box: its name (or, for HaiKIT, the logo) and its role. */
function Box({ node, at }: { node: Node; at: At }) {
  const logoW = 16 * LOGO_RATIO;
  return (
    <g>
      <rect
        className={node.brand ? "fill-hai-panel stroke-hai-fg stroke-[1.5]" : "fill-hai-panel-2 stroke-hai-line stroke-1"}
        x={at.x}
        y={at.y}
        width={at.w}
        height={at.h}
        rx={9}
      />
      {node.brand ? (
        <LogoAt x={at.anchor === "middle" ? at.textX - logoW / 2 : at.textX} y={at.nameY - 13} height={16} />
      ) : (
        <text className="fill-current text-sm font-semibold" x={at.textX} y={at.nameY} textAnchor={at.anchor}>
          {node.name}
        </text>
      )}
      <text className="fill-hai-dim text-[11.5px]" x={at.textX} y={at.roleY} textAnchor={at.anchor}>
        {node.role}
      </text>
    </g>
  );
}

/** An arrow's channel: the model's in the accent, the browser's in good. */
const channel = (a: Arrow) => (a.channel === "model" ? "text-hai-accent" : "text-hai-good");
const LABEL = "fill-current text-[11.5px] font-semibold";

/** Left to right: the boxes in a row, each link's arrows stacked between them. */
function wide(arch: Arch) {
  const W = 600, nodeW = 116, top = 1, rowGap = 30, firstRow = 30;
  const rows = 1 + Math.max(...arch.links.flat().map((a) => a.row));
  const nodeH = firstRow * 2 + (rows - 1) * rowGap;
  const step = (W - 2 - nodeW) / (arch.nodes.length - 1);
  const xs = arch.nodes.map((_, i) => 1 + i * step);
  const mid = top + nodeH / 2;
  const parts: ReactNode[] = arch.nodes.map((node, i) => (
    <Box
      key={`n${i}`}
      node={node}
      at={{ x: xs[i]!, y: top, w: nodeW, h: nodeH, textX: xs[i]! + nodeW / 2, nameY: mid - 1, roleY: mid + 17, anchor: "middle" }}
    />
  ));
  arch.links.forEach((arrows, i) => {
    const left = xs[i]! + nodeW + 7;
    const right = (xs[i + 1] ?? 0) - 7;
    arrows.forEach((a, j) => {
      const y = top + firstRow + a.row * rowGap;
      parts.push(
        <g key={`a${i}-${j}`} className={channel(a)}>
          {a.dir === "forward" ? <Line x1={left} y1={y} x2={right} y2={y} /> : <Line x1={right} y1={y} x2={left} y2={y} />}
          <text className={LABEL} x={(left + right) / 2} y={y - 7} textAnchor="middle">
            {a.label}
          </text>
        </g>,
      );
    });
  });
  return { viewBox: `0 0 ${W} ${top + nodeH + 1}`, parts };
}

/**
 * Top to bottom: the boxes in a column, each link's arrows listed between
 * them, pointing down (away from the LLM) or up (back to it).
 */
function narrow(arch: Arch) {
  const W = 300, nodeH = 52, rowH = 26, pad = 6;
  const parts: ReactNode[] = [];
  let y = 1;
  arch.nodes.forEach((node, i) => {
    parts.push(<Box key={`n${i}`} node={node} at={{ x: 1, y, w: W - 2, h: nodeH, textX: 16, nameY: y + 22, roleY: y + 40, anchor: "start" }} />);
    y += nodeH;
    const arrows = [...(arch.links[i] ?? [])].sort((a, b) => a.row - b.row);
    if (!arrows.length) return;
    y += pad;
    arrows.forEach((a, j) => {
      const [from, to] = a.dir === "forward" ? [y + 4, y + rowH - 4] : [y + rowH - 4, y + 4];
      parts.push(
        <g key={`a${i}-${j}`} className={channel(a)}>
          <Line x1={30} y1={from} x2={30} y2={to} />
          <text className={LABEL} x={44} y={y + rowH / 2 + 4}>
            {a.label}
          </text>
        </g>,
      );
      y += rowH;
    });
    y += pad;
  });
  return { viewBox: `0 0 ${W} ${y + 1}`, parts };
}

/**
 * The diagram as a figure, with its caption, and its claim spoken in full to
 * readers who can't see it.
 */
export function Architecture({ arch, className }: { arch: Arch; className?: string }) {
  const label = `${arch.caption} ${arch.description}`;
  const across = wide(arch);
  const down = narrow(arch);
  // An SVG grows with its width, labels and all: drawn at about the size the
  // old column gave it, however wide the window. The wide drawing is 600
  // units across, so below 580px its 11.5px labels would shrink past 11px:
  // the column drawing takes over there, at full size.
  return (
    <figure className={cn("@container my-[22px] mb-5", className)}>
      <svg role="img" aria-label={label} viewBox={across.viewBox} className="hidden h-auto w-full max-w-[720px] font-sans text-foreground @min-[580px]:block">
        {across.parts}
      </svg>
      <svg role="img" aria-label={label} viewBox={down.viewBox} className="block h-auto w-full max-w-[340px] font-sans text-foreground @min-[580px]:hidden">
        {down.parts}
      </svg>
      <figcaption className="mt-2 text-[13px] text-muted-foreground">{arch.caption}</figcaption>
    </figure>
  );
}
