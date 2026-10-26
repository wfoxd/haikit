/**
 * Pieces Rebook's surfaces share: the card and its head, the facts and legs
 * of a ticket, a price, a row of a list to pick from, and a row of segments.
 */

import type { ReactNode, Ref } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

/** A surface's card. The transcript frames each surface already, so it draws no frame of its own. */
export function Surface({ ref, className, children }: { ref?: Ref<HTMLDivElement>; className?: string; children: ReactNode }) {
  return (
    <Card ref={ref} className={cn("gap-3.5 rounded-none bg-transparent text-sm ring-0 [--card-spacing:--spacing(5)]", className)}>
      {children}
    </Card>
  );
}

/** A surface's head: what it is, a line under it, and its state on the right. */
export function Head({ title, sub, badge }: { title: string; sub: string; badge?: ReactNode }) {
  return (
    <CardHeader className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
      <div className="grid min-w-0 gap-0.5">
        <CardTitle className="text-[15px]/snug font-semibold text-balance">{title}</CardTitle>
        <CardDescription className="text-[13px]">{sub}</CardDescription>
      </div>
      {badge}
    </CardHeader>
  );
}

/** What each colour means: green is settled, orange a disruption, amber waiting on someone. */
const TONES = {
  ok: "bg-hai-good/15 text-hai-good",
  alert: "bg-hai-bad/15 text-hai-bad",
  wait: "bg-hai-warn/15 text-hai-warn",
};
export type Tone = keyof typeof TONES;

/** A surface's state, beside its title. */
export function Status({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <Badge className={cn("h-6 px-2.5 text-xs font-semibold", TONES[tone])}>{children}</Badge>;
}

/** An airport's code, as the ticket prints it. */
export const CODE = "font-mono text-[30px]/none font-semibold tracking-[0.02em]";
/** A time of day. */
export const TIME = "font-mono text-sm font-medium tabular-nums";
/** A label over a value: Flight, Seat, Gate. */
export const LABEL = "text-[11px] tracking-[0.06em] text-muted-foreground uppercase";
/** A row the traveller picked, or the answer on its way. */
export const PICKED = "border-primary bg-hai-accent/10 disabled:opacity-100";

/** "→", which a screen reader hears as "to". */
export function Arrow({ className }: { className?: string }) {
  return (
    <>
      <span aria-hidden className={cn("text-muted-foreground", className)}>
        →
      </span>
      <span className="sr-only">to</span>
    </>
  );
}

export type Fact = { k: string; v: string; moved?: boolean; key?: string };

/**
 * Labelled values, side by side. On a boarding pass they're larger, under a
 * tear line; a gate the airline has just moved is marked.
 */
export function Facts({ facts, pass }: { facts: Fact[]; pass?: boolean }) {
  return (
    <dl className={cn("flex flex-wrap gap-x-7 gap-y-2", pass && "border-t-2 border-dashed border-hai-line pt-3.5")}>
      {facts.map((f) => (
        <div key={f.key ?? f.k}>
          <dt className={LABEL}>{f.k}</dt>
          <dd className={cn("mt-0.5 font-mono text-[15px] font-semibold", pass && "text-xl", f.moved && "text-hai-bad motion-safe:animate-moved")}>{f.v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A trip's legs: from, to, and a line on each. */
export function Legs({ legs }: { legs: { from: string; to: string; detail: string }[] }) {
  return (
    <div className="grid gap-2">
      {legs.map((leg, i) => (
        <div key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className={CODE}>{leg.from}</span>
          <Arrow />
          <span className={CODE}>{leg.to}</span>
          <span className="font-mono text-[13px] text-muted-foreground">{leg.detail}</span>
        </div>
      ))}
    </div>
  );
}

/** A price, line by line, its total last; in orange when the airline has just raised it. */
export function Price({ rows, raised }: { rows: { k: string; v: string; total?: boolean }[]; raised?: boolean }) {
  return (
    <dl className="grid max-w-[320px] gap-1">
      {rows.map((r) => (
        <div key={r.k} className={cn("flex justify-between gap-4", r.total && "border-t border-hai-line pt-1.5")}>
          <dt className={cn("text-muted-foreground", r.total && "font-semibold text-foreground")}>{r.k}</dt>
          <dd className={cn("font-mono font-medium", r.total && "text-xl font-semibold", r.total && raised && "text-hai-bad")}>{r.v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A line under a surface: how it works, or what became of its question. */
export function Foot({ children }: { children: ReactNode }) {
  return <p className="text-[13px] text-muted-foreground">{children}</p>;
}

/** Something the airline changed, in orange. */
export function Why({ children }: { children: ReactNode }) {
  return <p className="font-semibold text-hai-bad">{children}</p>;
}

/** A row of buttons under a question. */
export function Actions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>;
}

/**
 * One flight in a list to pick from: its times, its flights and how it goes,
 * and what it costs with how many seats are left. While it can be picked it's
 * a button; once the question is closed, or the flight is sold out, it's a
 * row. In a narrow card the times go on a line of their own.
 */
export function OptionRow({
  dataKey,
  button,
  disabled,
  picked,
  gone,
  onPick,
  depart,
  arrive,
  title,
  detail,
  fare,
  left,
}: {
  dataKey: string;
  button: boolean;
  disabled: boolean;
  picked: boolean;
  gone?: boolean;
  onPick: () => void;
  depart: string;
  arrive: string;
  title: string;
  detail: string;
  fare: ReactNode;
  left: ReactNode;
}) {
  const ROW = cn(
    "grid h-auto w-full grid-cols-[max-content_minmax(0,1fr)_auto] items-center justify-normal gap-x-4 gap-y-1 border border-hai-line bg-secondary px-3 py-2.5 text-left text-sm font-normal whitespace-normal @max-[480px]:grid-cols-[minmax(0,1fr)_auto]",
    picked && PICKED,
    gone && "opacity-50",
  );
  const contents = (
    <>
      <span className="flex items-baseline gap-1.5 whitespace-nowrap @max-[480px]:col-span-full">
        <span className={TIME}>{depart}</span>
        <Arrow />
        <span className={TIME}>{arrive}</span>
      </span>
      <span className="grid min-w-0 gap-0.5">
        <span className="font-mono font-semibold">{title}</span>
        <span className="text-[13px] text-muted-foreground">{detail}</span>
      </span>
      <span className="grid justify-items-end gap-0.5">
        {fare}
        {left}
      </span>
    </>
  );
  if (!button) return <div className={ROW}>{contents}</div>;
  return (
    <Button variant="outline" data-key={dataKey} disabled={disabled} onClick={onPick} className={cn(ROW, "hover:border-primary hover:bg-secondary")}>
      {contents}
    </Button>
  );
}

/** How many seats are left: amber when few, orange when none. */
export function SeatsLeft({ n, children }: { n: number; children: ReactNode }) {
  return <span className={cn("text-xs text-muted-foreground", n === 0 ? "font-semibold text-hai-bad" : n <= 2 && "font-semibold text-hai-warn")}>{children}</span>;
}

/**
 * One of a few, side by side: the filters, an airport, a day. One is always
 * on: pressing it again leaves it on, as a filter can't be none of them.
 * Each carries `name:value` as its key, so the keyboard keeps its place.
 */
export function Segments<V extends string>({
  name,
  label,
  value,
  onChange,
  items,
  disabled,
  itemClassName,
}: {
  name: string;
  label: string;
  value: V | null;
  onChange: (value: V) => void;
  items: readonly { value: V; label: ReactNode }[];
  disabled?: boolean;
  itemClassName?: string;
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      spacing={1.5}
      aria-label={label}
      value={value ?? ""}
      onValueChange={(v) => v && onChange(v as V)}
      disabled={disabled}
      className="flex-wrap"
    >
      {items.map((item) => (
        <ToggleGroupItem
          key={item.value}
          value={item.value}
          data-key={`${name}:${item.value}`}
          className={cn(
            "border-hai-line text-[13px] font-normal data-[state=on]:border-primary data-[state=on]:bg-transparent data-[state=on]:font-semibold data-[state=on]:text-primary",
            itemClassName,
          )}
        >
          {item.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
