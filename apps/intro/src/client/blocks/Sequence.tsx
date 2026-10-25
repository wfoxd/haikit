import { useState, type CSSProperties } from "react";
import type { Step } from "../../shared/surfaces.ts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { inline } from "./inline.tsx";

const LANES = ["browser", "server", "model"] as const;
const LANE_NAMES = { browser: "Browser", server: "Server", model: "Model" };

/** Each step's colour: the channel it travels on. */
const TONES = { plain: "text-foreground", model: "text-hai-accent", ui: "text-hai-good", park: "text-hai-warn" };

/** Where a lane's line runs, as a share of the track: the middle of its third. */
const at = (lane: number) => `${((lane * 2 + 1) / 6) * 100}%`;

/**
 * The sequence diagram: Browser | Server | Model. Its stepping is
 * component-local state: the lesson contract declares no action for it, so
 * these clicks cannot reach the server.
 */
export function Sequence({ block }: { block: { title: string; steps: Step[] } }) {
  const [current, setCurrent] = useState(0);
  const last = block.steps.length - 1;
  const go = (i: number) => setCurrent(Math.max(0, Math.min(last, i)));
  const step = block.steps[current];

  return (
    <figure
      tabIndex={0}
      aria-label={`${block.title}: a sequence diagram. Use the left and right arrow keys to step through it.`}
      className="my-[22px] border border-hai-line bg-card px-[18px] pt-4 pb-3.5 font-sans"
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") {
          e.preventDefault();
          go(current + 1);
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          go(current - 1);
        }
      }}
    >
      <div className="flex justify-between gap-3 text-sm">
        <span className="font-heading font-bold">{block.title}</span>
        <span className="text-muted-foreground tabular-nums">
          Step {current + 1} of {block.steps.length}
        </span>
      </div>
      <div className="mt-3.5 mb-0.5 ml-[2.2em] grid grid-cols-3 text-center text-[13px] font-semibold max-sm:text-[10.5px]">
        <span className="text-hai-good">Browser</span>
        <span>Server</span>
        <span className="text-hai-accent">Model</span>
      </div>
      <ol className="m-0 list-none p-0">
        {block.steps.map((s, i) => {
          const from = LANES.indexOf(s.from);
          const to = LANES.indexOf(s.to);
          const a = Math.min(from, to);
          const b = Math.max(from, to);
          const now = i === current;
          return (
            <li
              key={i}
              data-state={i < current ? "done" : now ? "current" : "todo"}
              className={cn(
                "grid h-[38px] grid-cols-[2.2em_1fr] transition-opacity duration-150 motion-reduce:transition-none",
                TONES[s.tone ?? "plain"],
                i < current && "opacity-[.42]",
                i > current && "opacity-20",
                now && "bg-secondary",
              )}
            >
              <span className={cn("self-center pl-1.5 font-mono text-[11.5px]", now ? "font-semibold" : "text-muted-foreground")}>
                {i + 1}
              </span>
              <div className="relative">
                {LANES.map((lane, k) => (
                  <span key={lane} aria-hidden className="absolute inset-y-0 w-px bg-hai-line" style={{ left: at(k) }} />
                ))}
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={`Step ${i + 1}: ${LANE_NAMES[s.from]} to ${LANE_NAMES[s.to]}, ${s.label}`}
                  onClick={() => go(i)}
                  className={cn(
                    "absolute top-[3px] h-8 cursor-pointer p-0 font-mono text-xs",
                    now && "text-[12.5px] font-semibold",
                    from === to && "flex -translate-x-1.5 items-center gap-2.5",
                  )}
                  style={from === to ? { left: at(a) } : ({ left: at(a), width: `${((b - a) / 3) * 100}%` } as CSSProperties)}
                >
                  {from === to ? (
                    <>
                      <span aria-hidden className="size-3 flex-none rounded-full border-2 border-current bg-card" />
                      <span>{s.label}</span>
                    </>
                  ) : (
                    <>
                      <span className="absolute bottom-[13px] left-1/2 -translate-x-1/2 whitespace-nowrap">{s.label}</span>
                      <span aria-hidden className={cn("absolute inset-x-0 bottom-2 bg-current", now ? "h-[3px]" : "h-0.5")} />
                      <span
                        aria-hidden
                        className={cn(
                          "absolute bottom-1 size-0 border-y-[5px] border-y-transparent",
                          to > from ? "-right-0.5 border-l-8 border-l-current" : "-left-0.5 border-r-8 border-r-current",
                        )}
                      />
                    </>
                  )}
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      <p aria-live="polite" className="mt-3 mb-2.5 min-h-[3.2em] bg-secondary px-3 py-2.5 text-[15px]/[1.55]">
        {step && inline(step.note)}
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" disabled={current === 0} onClick={() => go(current - 1)}>
          Back
        </Button>
        <Button size="sm" disabled={current === last} onClick={() => go(current + 1)}>
          Next step
        </Button>
      </div>
    </figure>
  );
}
