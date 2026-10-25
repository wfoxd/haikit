/**
 * The welcome screen's illustrations. Each draws what its words claim rather
 * than decorating it:
 *
 *   screens         software today: a screen of controls, and the trail of
 *                   clicks one job takes through it
 *   request         software HaiKIT builds: one sentence, the options that
 *                   fit, one click
 *
 * and, for a welcome stored before version 11, one per section:
 *
 *   payload-split   one tool call, full data to the app, a digest to the LLM
 *   llm-flow        the LLM picks a tool, and asking is a component that waits
 *   contract-split  one contract, a server half and a browser half, both checked
 *
 * Drawn 360 units wide, so their labels stay readable from a phone to a wide
 * card. Paint comes from the classes below, built from the --hai-* tokens, so
 * they follow the light and dark schemes.
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Arrow, Head } from "./svg.tsx";

const W = 360;

/** Each part's paint. Text and lines take the colour of the group around them, unless named here. */
const C = {
  card: "fill-hai-panel-2 stroke-hai-line",
  strong: "fill-hai-panel stroke-hai-fg stroke-[1.5]",
  model: "fill-hai-accent-soft stroke-hai-accent",
  ui: "fill-hai-good-soft stroke-hai-good",
  option: "fill-hai-panel-2 stroke-hai-line",
  picked: "fill-hai-good-soft stroke-hai-good stroke-[1.5]",
  cursor: "fill-hai-fg stroke-hai-panel stroke-1",
  row: "stroke-current stroke-[3.5] [stroke-linecap:round] opacity-45",
  sep: "stroke-hai-line stroke-1",
  chrome: "fill-hai-line",
  tab: "fill-hai-panel stroke-hai-dim",
  button: "fill-hai-dim opacity-55",
  chevron: "fill-none stroke-current stroke-[1.5]",
  trail: "fill-none stroke-current stroke-[1.5] [stroke-dasharray:3_3]",
  wire: "fill-none stroke-current stroke-[1.75]",
  faint: "fill-none stroke-current stroke-[1.75] [stroke-dasharray:4_4] opacity-60",
  dot: "fill-current",
  check: "fill-none stroke-hai-panel stroke-2 [stroke-linecap:round] [stroke-linejoin:round]",
  bubble: "fill-hai-user-bg",
  barUi: "fill-hai-good",
  barModel: "fill-hai-accent",
  // text
  label: "fill-current text-[15px] font-semibold",
  sub: "fill-hai-dim text-[13px]",
  subStrong: "fill-current text-[13px] font-semibold",
  code: "fill-hai-dim font-mono text-xs",
  stepN: "fill-hai-panel text-[10px] font-bold",
  say: "fill-current text-[13.5px]",
  opt: "fill-current text-xs",
};

/** A group's colour, for the text and lines inside it. */
const G = {
  model: "text-hai-accent",
  ui: "text-hai-good",
  wait: "text-hai-warn",
  dim: "text-hai-dim",
  ink: "text-hai-fg",
  ok: "text-hai-good",
};

/** A rounded card. */
const Card = ({ cls, x, y, w, h }: { cls: string; x: number; y: number; w: number; h: number }) => (
  <rect className={cls} x={x} y={y} width={w} height={h} rx={10} />
);

function Text({ cls, x, y, children, anchor }: { cls: string; x: number; y: number; children: ReactNode; anchor?: "middle" }) {
  return (
    <text className={cls} x={x} y={y} textAnchor={anchor}>
      {children}
    </text>
  );
}

/** Lines standing in for rows of content. */
const rows = (x: number, y: number, lengths: number[], gap = 8) =>
  lengths.map((len, i) => <line key={i} className={C.row} x1={x} y1={y + i * gap} x2={x + len} y2={y + i * gap} />);

/** An app's window: its frame, and the bar across its top. */
const Frame = () => (
  <>
    <Card cls={C.card} x={4} y={4} w={352} h={172} />
    <line className={C.sep} x1={4} y1={26} x2={356} y2={26} />
    {[16, 26, 36].map((x) => (
      <circle key={x} className={C.chrome} cx={x} cy={15} r={2.5} />
    ))}
  </>
);

/** Software today: a screen of controls, and the trail of clicks one job takes through it. */
function Screens() {
  const fields = [
    { x: 96, y: 68, w: 116, label: 34 },
    { x: 224, y: 68, w: 120, label: 28 },
    { x: 96, y: 98, w: 116, label: 40 },
    { x: 224, y: 98, w: 120, label: 32 },
    { x: 96, y: 128, w: 248, label: 48 },
  ];
  // the job: seven clicks, from the menu to the button, each found by the person
  const clicks = [
    [104, 15],
    [40, 76],
    [178, 45],
    [150, 80],
    [290, 110],
    [190, 140],
    [317, 162],
  ] as const;
  return (
    <>
      <Frame />
      {/* the menu bar, the sidebar and the tabs */}
      <g className={G.dim}>
        {[
          [56, 22],
          [90, 28],
          [130, 20],
          [162, 30],
          [204, 24],
        ].map(([x, len]) => (
          <line key={x} className={C.row} x1={x} y1={15} x2={x! + len!} y2={15} />
        ))}
        <line className={C.sep} x1={84} y1={26} x2={84} y2={176} />
        {rows(16, 44, [52, 40, 56, 36, 48, 30, 44], 16)}
        {[96, 152, 208].map((x, i) => (
          <rect key={x} className={i ? C.option : C.tab} x={x} y={36} width={52} height={18} rx={4} />
        ))}
        {/* a form: labels over fields, a dropdown, and its buttons */}
        {fields.map((f) => (
          <g key={`${f.x},${f.y}`}>
            <line className={C.row} x1={f.x} y1={f.y} x2={f.x + f.label} y2={f.y} />
            <rect className={C.option} x={f.x} y={f.y + 5} width={f.w} height={15} rx={3} />
          </g>
        ))}
        <path className={C.chevron} d="M332 109 l4 4 l4 -4" />
        <rect className={C.option} x={232} y={154} width={52} height={16} rx={4} />
        <rect className={C.button} x={290} y={154} width={54} height={16} rx={4} />
      </g>
      <g className={G.wait}>
        <path className={C.trail} d={`M${clicks.map(([x, y]) => `${x} ${y}`).join(" L")}`} />
        {clicks.map(([x, y], i) => (
          <g key={i}>
            <circle className={C.dot} cx={x} cy={y} r={7.5} />
            <Text cls={C.stepN} x={x} y={y + 3.5} anchor="middle">
              {i + 1}
            </Text>
          </g>
        ))}
      </g>
      <Text cls={C.sub} x={4} y={198}>
        Seven clicks, if you know where they are
      </Text>
    </>
  );
}

/** Software HaiKIT builds: one sentence, the options that fit, and one click. */
function Request() {
  const options = ["UA 875 · Wed 10:30 · nonstop", "NH 7 · Wed 11:00 · nonstop", "JL 1 · Wed 12:45 · nonstop"];
  return (
    <>
      <Frame />
      {/* what the person says */}
      <rect className={C.bubble} x={130} y={37} width={214} height={28} rx={14} />
      <Text cls={C.say} x={237} y={55.5} anchor="middle">
        Get me to Tokyo by tomorrow
      </Text>
      {/* the AI's answer: the options that fit, as a component, one of them clicked */}
      <g className={G.model}>
        <circle className={C.dot} cx={22} cy={84} r={5} />
      </g>
      <Text cls={C.say} x={34} y={88.5}>
        These 3 fit. Which one?
      </Text>
      <Card cls={C.strong} x={16} y={98} w={328} h={72} />
      {options.map((label, i) => {
        const y = 106 + i * 20;
        return (
          <g key={label}>
            <rect className={i === 1 ? C.picked : C.option} x={26} y={y} width={308} height={16} rx={4} />
            <Text cls={C.opt} x={36} y={y + 12}>
              {label}
            </Text>
          </g>
        );
      })}
      <path className={C.cursor} d="M300 132 L300 148 L304 144 L307 151 L310 150 L307 143 L312 143 Z" />
      <Text cls={C.sub} x={4} y={198}>
        One sentence, one click
      </Text>
    </>
  );
}

/** One tool call: the full data goes to the app, a short digest to the LLM. */
function PayloadSplit() {
  return (
    <>
      <Card cls={C.strong} x={110} y={4} w={140} h={30} />
      <Text cls={C.label} x={180} y={24} anchor="middle">
        one tool call
      </Text>
      {/* the call forks: data one way, digest the other */}
      <g className={G.ui}>
        <path className={C.wire} d="M180 34 C180 48 89 44 89 59" />
        <Head x={89} y={60} ux={0} uy={1} />
      </g>
      <g className={G.model}>
        <path className={C.wire} d="M180 34 C180 48 276 44 276 59" />
        <Head x={276} y={60} ux={0} uy={1} />
      </g>
      <g className={G.ui}>
        <Card cls={C.ui} x={4} y={60} w={170} h={84} />
        <Text cls={C.label} x={16} y={82}>
          Full data
        </Text>
        <Text cls={C.sub} x={16} y={98}>
          to your app
        </Text>
        {rows(16, 112, [134, 112, 128, 100])}
      </g>
      <g className={G.model}>
        <Card cls={C.model} x={196} y={60} w={160} h={58} />
        <Text cls={C.label} x={208} y={82}>
          Digest
        </Text>
        <Text cls={C.sub} x={208} y={98}>
          to the LLM
        </Text>
        {rows(208, 108, [70])}
      </g>
      {/* the share: 97 parts browser to 3 parts model */}
      <rect className={C.barUi} x={4} y={156} width={341} height={8} rx={4} />
      <rect className={C.barModel} x={347} y={156} width={9} height={8} rx={3} />
      <Text cls={C.sub} x={4} y={182}>
        97% of the data never reaches the model
      </Text>
    </>
  );
}

/** The LLM picks the next tool; asking is a component that waits for a click. */
function LlmFlow() {
  // three tools it could call; this time it asks
  const tools = [
    { y: 14, name: "search", chosen: false },
    { y: 74, name: "compare", chosen: false },
    { y: 134, name: "ask you", chosen: true },
  ];
  return (
    <>
      <g className={G.model}>
        <Card cls={C.model} x={4} y={64} w={72} h={48} />
        <Text cls={C.label} x={40} y={93} anchor="middle">
          LLM
        </Text>
      </g>
      {tools.map((t) => {
        const cy = t.y + 14;
        return (
          <g key={t.name} className={t.chosen ? G.model : G.dim}>
            <path className={t.chosen ? C.wire : C.faint} d={`M76 88 C96 88 96 ${cy} 113 ${cy}`} />
            {t.chosen && <Head x={116} y={cy} ux={1} uy={0} />}
            <Card cls={t.chosen ? C.model : C.card} x={116} y={t.y} w={96} h={28} />
            <Text cls={t.chosen ? C.label : C.sub} x={164} y={t.y + 19} anchor="middle">
              {t.name}
            </Text>
          </g>
        );
      })}
      {/* the question, as a component: one option picked */}
      <g className={G.model}>
        <Arrow x1={212} y1={148} x2={238} y2={122} />
      </g>
      <Card cls={C.strong} x={240} y={44} w={116} h={118} />
      <Text cls={C.label} x={252} y={68}>
        Which one?
      </Text>
      {[80, 102, 124].map((y, i) => (
        <rect key={y} className={i === 1 ? C.picked : C.option} x={252} y={y} width={92} height={16} rx={4} />
      ))}
      <path className={C.cursor} d="M318 104 L318 120 L322 116 L325 123 L328 122 L325 115 L330 115 Z" />
      <g className={G.wait}>
        <circle className={C.dot} cx={246} cy={177} r={4} />
        <Text cls={C.subStrong} x={256} y={182}>
          waits for you
        </Text>
      </g>
    </>
  );
}

/** One contract, implemented twice, and TypeScript holds both halves to it. */
function ContractSplit() {
  const halves = [
    { x: 4, group: G.model, fill: C.model, name: "server half", from: 150, to: 79 },
    { x: 206, group: G.ui, fill: C.ui, name: "browser half", from: 210, to: 281 },
  ];
  return (
    <>
      <Card cls={C.strong} x={100} y={4} w={160} h={52} />
      <Text cls={C.label} x={180} y={26} anchor="middle">
        one contract
      </Text>
      <Text cls={C.code} x={180} y={45} anchor="middle">
        defineSurface()
      </Text>
      {halves.map((half) => {
        const mx = (half.from + half.to) / 2;
        return (
          <g key={half.name}>
            <g className={G.ink}>
              <Arrow x1={half.from} y1={56} x2={half.to} y2={102} />
            </g>
            <g className={half.group}>
              <Card cls={half.fill} x={half.x} y={104} w={150} h={58} />
              <Text cls={C.label} x={half.x + 14} y={128}>
                {half.name}
              </Text>
              {rows(half.x + 14, 142, [96, 64], 9)}
            </g>
            {/* a check on each line: the compiler holds this half to the contract */}
            <g className={G.ok}>
              <circle className={C.dot} cx={mx} cy={79} r={9} />
              <path className={C.check} d={`M${mx - 4} 79 l3 3 l5 -6`} />
            </g>
          </g>
        );
      })}
      <Text cls={C.sub} x={180} y={182} anchor="middle">
        TypeScript checks both halves
      </Text>
    </>
  );
}

const DRAW = {
  screens: [Screens, 206],
  request: [Request, 206],
  "payload-split": [PayloadSplit, 186],
  "llm-flow": [LlmFlow, 186],
  "contract-split": [ContractSplit, 186],
} as const;

/** A section's illustration as a figure, or nothing for one this page can't draw. */
export function Illustration({ image, className, svgClassName }: { image: { kind: string; alt: string }; className?: string; svgClassName?: string }) {
  const draw = DRAW[image.kind as keyof typeof DRAW];
  if (!draw) return null;
  const [Drawing, h] = draw;
  return (
    <figure className={className}>
      <svg
        role="img"
        aria-label={image.alt}
        viewBox={`0 0 ${W} ${h}`}
        className={cn("block h-auto w-full max-w-[420px] font-sans text-foreground", svgClassName)}
      >
        <Drawing />
      </svg>
    </figure>
  );
}
