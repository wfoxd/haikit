import { useRef, useState } from "react";
import type { SurfaceProps } from "@haikit/react";
import type { HomeFlight, flightResults } from "../../shared/surfaces.ts";
import { CardContent } from "@/components/ui/card";
import { useAsk } from "@/lib/ask";
import { useKeepFocus } from "@/lib/focus";
import { DAY_NAMES, dollars, later } from "@/lib/format";
import { useShowTop } from "@/lib/scroll";
import { Foot, Head, OptionRow, SeatsLeft, Segments, Surface } from "./parts.tsx";

// LOCAL: no action is declared for filtering, so it stays in the browser.
const FILTERS = [
  { value: "all", label: "All", keep: (_f: HomeFlight) => true },
  { value: "nonstop", label: "Nonstop", keep: (f: HomeFlight) => !f.via },
  { value: "NRT", label: "Narita", keep: (f: HomeFlight) => f.from === "NRT" },
  { value: "HND", label: "Haneda", keep: (f: HomeFlight) => f.from === "HND" },
] as const;
type Filter = (typeof FILTERS)[number]["value"];

/** The flights home on the day searched. */
export function FlightResults({ props, send, state, mode, selection }: SurfaceProps<typeof flightResults>) {
  const root = useRef<HTMLDivElement>(null);
  useKeepFocus(root);
  useShowTop(root, state);
  const [only, setOnly] = useState<Filter>("all");
  const { sending, picked, ask } = useAsk(state, selection);
  const live = state === "live" && mode === "elicit";
  const keep = FILTERS.find((f) => f.value === only)?.keep ?? (() => true);
  const chosen = props.flights.find((f) => f.id === picked);

  return (
    <Surface ref={root}>
      <Head
        title={`Flights home · ${DAY_NAMES[props.date]}`}
        sub={props.filter ? `${props.flights.length} ${props.filter}, of ${props.total}` : `${props.flights.length} flights to San Francisco`}
      />
      <CardContent className="@container grid gap-3.5">
        <Segments name="filter" label="Show" value={only} onChange={setOnly} items={FILTERS} />
        <ol className="grid gap-1.5">
          {props.flights.filter(keep).map((f) => (
            <li key={f.id}>
              <OptionRow
                dataKey={`flight:${f.id}`}
                button={live}
                disabled={sending}
                picked={f.id === picked}
                // DECLARED: `choose` is a resolve action
                onPick={() => ask(f.id, () => send("choose", f.id))}
                depart={f.depart.slice(4)}
                arrive={f.arrive.slice(4)}
                title={`${f.flights.join(" + ")} · ${f.airline}`}
                detail={`${f.from} · ${f.via ? `via ${f.via}` : "Nonstop"} · ${later(f.durationMin)} · lands the same day`}
                fare={<span className="font-mono font-semibold">{`from ${dollars(f.price)}`}</span>}
                left={<SeatsLeft n={f.seatsLeft}>{`${f.seatsLeft} seat${f.seatsLeft === 1 ? "" : "s"} left`}</SeatsLeft>}
              />
            </li>
          ))}
        </ol>
        <Foot>
          {state === "frozen"
            ? chosen
              ? `You chose ${chosen.flights.join(" + ")}.`
              : "Closed when you typed instead."
            : "Times are local: Tokyo when it leaves, San Francisco when it lands. Prices are the Basic fare, before taxes."}
        </Foot>
      </CardContent>
    </Surface>
  );
}
