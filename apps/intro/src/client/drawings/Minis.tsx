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

import type { ReactNode } from "react";
import type { WelcomeProps } from "../../shared/surfaces.ts";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type MiniLine = Exclude<WelcomeProps["example"]["steps"][number]["scene"][number], { from: string }>;
type Fact = { k: string; v: string; moved?: boolean | undefined };
type Of<K extends MiniLine["ui"]> = Extract<MiniLine, { ui: K }>;

/** What each kind is, for a screen reader. */
const NAMES = { trip: "trip card", options: "list of options", seats: "seat map", choices: "question", pass: "boarding pass" };

/** "Seat 11F": the seat map's letters, the aisle between C and D. */
const LETTERS = ["A", "B", "C", "D", "E", "F"];

const BADGES = {
  ok: "bg-hai-good-soft text-hai-good",
  alert: "bg-hai-bad-soft text-hai-bad",
  wait: "bg-hai-warn-soft text-hai-warn",
};

const DIM = "text-[11px] text-muted-foreground";
const ROUTE = "flex flex-wrap items-baseline gap-x-2.5 gap-y-1";
const CODE = "font-mono text-xl/[1.1] font-semibold tracking-[0.02em]";
const ITEM = "border border-hai-line-soft bg-secondary px-[9px] py-1.5";
const PICKED = "border-[1.5px] border-hai-good bg-hai-good-soft";

/** Facts as a row of labelled values; one that just changed stands out. */
function Facts({ facts, className, size }: { facts: Fact[]; className?: string; size?: string }) {
  return (
    <dl className={cn("flex flex-wrap gap-x-[22px] gap-y-1.5", className)}>
      {facts.map((f, i) => (
        <div key={i} className={f.moved ? "text-hai-bad" : undefined}>
          <dt className="text-[10px] tracking-[0.06em] text-muted-foreground uppercase">{f.k}</dt>
          <dd className={cn("mt-px font-mono font-semibold", size ?? "text-[12.5px]")}>{f.v}</dd>
        </div>
      ))}
    </dl>
  );
}

const Why = ({ why }: { why?: string | undefined }) => (why ? <p className="text-xs text-hai-bad">{why}</p> : null);
const Sr = ({ children }: { children: ReactNode }) => <span className="sr-only">{children}</span>;

function Trip({ c }: { c: Of<"trip"> }) {
  return (
    <>
      <div className={ROUTE}>
        {[c.from, c.to].map((stop, i) => (
          <span key={i} className="contents">
            {i > 0 && <span className="text-muted-foreground">→</span>}
            <span className="grid">
              <span className={CODE}>{stop.code}</span>
              <span className={DIM}>
                {stop.city} · {stop.time}
              </span>
            </span>
          </span>
        ))}
      </div>
      <Facts facts={c.facts} />
      <Why why={c.why} />
    </>
  );
}

function Options({ c }: { c: Of<"options"> }) {
  return (
    <>
      {c.chips && (
        <div className="flex flex-wrap gap-[5px]">
          {c.chips.map((chip, i) => (
            <span key={i} className={cn("border border-hai-line px-[9px] py-px text-[11px]", chip.on && "border-hai-accent font-semibold text-hai-accent")}>
              {chip.label}
            </span>
          ))}
        </div>
      )}
      <ol className="grid list-none gap-[5px]">
        {c.rows.map((r, i) => (
          // a narrow card: an option's cost under it, not beside it
          <li key={i} className={cn(ITEM, "flex justify-between gap-2.5 @max-[340px]:flex-col @max-[340px]:gap-[3px]", r.picked && PICKED)}>
            <span className="grid content-start gap-px">
              <span className="font-mono text-xs font-semibold">{r.flights}</span>
              <span className={DIM}>
                {r.depart} → {r.arrive} · {r.detail}
              </span>
            </span>
            <span className="grid shrink-0 content-start gap-px text-right @max-[340px]:flex @max-[340px]:flex-wrap @max-[340px]:gap-x-2.5 @max-[340px]:text-left">
              <span className={cn("text-[11.5px] font-semibold", r.free && "text-hai-good")}>{r.fare}</span>
              <span className={cn(DIM, r.low && "font-semibold text-hai-warn")}>{r.left}</span>
            </span>
            {r.picked && <Sr> (clicked)</Sr>}
          </li>
        ))}
      </ol>
      {c.more && <p className="text-[11.5px] text-muted-foreground">{c.more}</p>}
    </>
  );
}

const SEATS = { ".": "", L: "border-[color-mix(in_srgb,var(--hai-good)_60%,var(--hai-line))] text-hai-good", x: "border-transparent bg-hai-line", "*": "border-hai-accent bg-hai-accent font-semibold text-hai-on-accent" };

function Seats({ c }: { c: Of<"seats"> }) {
  let picked: string | null = null;
  for (const row of c.rows) {
    const at = row.seats.indexOf("*");
    if (at >= 0) picked = `${row.n}${LETTERS[at]}`;
  }
  return (
    <>
      {/* a picture: the line after it says what was picked */}
      <div aria-hidden className="grid justify-start gap-1">
        {c.rows.map((row) => (
          <div key={row.n} className="flex items-center gap-1">
            <span className="mr-1 w-[18px] text-right font-mono text-[10.5px] text-muted-foreground">{row.n}</span>
            {[...row.seats].map((s, i) => (
              <span key={i} className="contents">
                {i === 3 && <span className="w-2.5" />}
                <span
                  className={cn(
                    "grid size-5 place-items-center rounded-t-[5px] rounded-b-[3px] border border-hai-line font-mono text-[9.5px] text-muted-foreground",
                    SEATS[s as keyof typeof SEATS],
                  )}
                >
                  {s === "x" ? "" : LETTERS[i]}
                </span>
              </span>
            ))}
          </div>
        ))}
      </div>
      {picked && <p className="sr-only">Seat {picked} picked; grey seats are taken.</p>}
      <p className="text-[11.5px] text-muted-foreground">{c.foot}</p>
    </>
  );
}

function Choices({ c }: { c: Of<"choices"> }) {
  return (
    <ul className="grid list-none gap-[5px]">
      {c.choices.map((choice, i) => (
        <li key={i} className={cn(ITEM, "grid content-start gap-px", choice.picked && PICKED)}>
          <span className="text-[12.5px] font-semibold">
            {choice.picked && (
              <span aria-hidden className="text-hai-good">
                ✓{" "}
              </span>
            )}
            {choice.title}
          </span>
          <span className={DIM}>{choice.detail}</span>
          {choice.picked && <Sr> (clicked)</Sr>}
        </li>
      ))}
    </ul>
  );
}

function Pass({ c }: { c: Of<"pass"> }) {
  return (
    <>
      <div>
        {c.legs.map((leg, i) => (
          <div key={i} className={cn(ROUTE, "items-center")}>
            <span className={CODE}>{leg.from}</span>
            <span className="text-muted-foreground">→</span>
            <span className={CODE}>{leg.to}</span>
            <span className="font-mono text-[11.5px] text-muted-foreground">{leg.flight}</span>
          </div>
        ))}
      </div>
      <Facts facts={c.facts} className="border-t-2 border-dashed border-hai-line pt-[9px]" size="text-sm" />
      <Why why={c.why} />
      {c.foot && <p className="text-[11.5px] text-muted-foreground">{c.foot}</p>}
    </>
  );
}

/** One of the demo's components, drawn small under its tool's row. */
export function Mini({ c }: { c: MiniLine }) {
  return (
    <div
      role="group"
      aria-label={`Rebook's ${NAMES[c.ui]}, from its ${c.tool} tool${c.asks ? ", waiting for a click" : ""}`}
      className="@container overflow-hidden border border-hai-line bg-card"
    >
      {/* the group's name says the same */}
      <div aria-hidden className="flex justify-between gap-2 border-b border-hai-line-soft bg-secondary px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
        <span>{c.tool}</span>
        <span className={c.asks ? "text-hai-warn" : "text-hai-good"}>{c.asks ? "waits for you" : "✓"}</span>
      </div>
      <div
        className={cn(
          "grid gap-[9px] px-3 pt-2.5 pb-3 font-sans text-[12.5px]/[1.35]",
          // a trip, edged in red once it's cancelled; a boarding pass, an accent edge on top
          c.ui === "trip" && c.badge?.tone === "alert" && "shadow-[inset_3px_0_0_var(--hai-bad)]",
          c.ui === "pass" && "shadow-[inset_0_3px_0_var(--hai-accent)]",
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-x-2.5 gap-y-1">
          <div>
            <p className="text-sm font-semibold">{c.title}</p>
            <p className="text-[11.5px] text-muted-foreground">{c.sub}</p>
          </div>
          {c.badge && <Badge className={cn("text-[11px] font-semibold", BADGES[c.badge.tone])}>{c.badge.text}</Badge>}
        </div>
        {c.ui === "trip" ? (
          <Trip c={c} />
        ) : c.ui === "options" ? (
          <Options c={c} />
        ) : c.ui === "seats" ? (
          <Seats c={c} />
        ) : c.ui === "choices" ? (
          <Choices c={c} />
        ) : (
          <Pass c={c} />
        )}
      </div>
    </div>
  );
}
