import { useRef, useState } from "react";
import type { SurfaceProps } from "@haikit/react";
import type { RebookOption, rebookingOptions } from "../../shared/surfaces.ts";
import { CardContent } from "@/components/ui/card";
import { useAsk } from "@/lib/ask";
import { useKeepFocus } from "@/lib/focus";
import { later } from "@/lib/format";
import { useShowTop } from "@/lib/scroll";
import { cn } from "@/lib/utils";
import { Foot, Head, OptionRow, SeatsLeft, Segments, Status, Surface } from "./parts.tsx";

// LOCAL: the contract declares no action for filtering, so it never reaches
// the server or costs the model a turn.
const FILTERS = [
  { value: "all", label: "All", keep: (_o: RebookOption) => true },
  { value: "nonstop", label: "Nonstop", keep: (o: RebookOption) => !o.via },
  { value: "free", label: "No extra cost", keep: (o: RebookOption) => o.extraFare === 0 },
  { value: "tonight", label: "Tonight", keep: (o: RebookOption) => o.tonight },
] as const;
type Filter = (typeof FILTERS)[number]["value"];

/**
 * Every way to get there instead. A revision from the airline, such as its
 * holds running out, keeps the filter the traveller chose, and the keyboard.
 */
export function RebookingOptions({ props, send, state, mode, selection }: SurfaceProps<typeof rebookingOptions>) {
  const root = useRef<HTMLDivElement>(null);
  useKeepFocus(root);
  // Fourteen options are taller than the window: open on the first.
  useShowTop(root, state);
  const [only, setOnly] = useState<Filter>("all");
  const { sending, picked, ask } = useAsk(state, selection);
  const live = state === "live" && mode === "elicit";
  const keep = FILTERS.find((f) => f.value === only)?.keep ?? (() => true);
  const chosen = props.options.find((o) => o.id === picked);

  return (
    <Surface ref={root}>
      <Head
        title={`Instead of ${props.cancelled}`}
        sub={props.filter ? `${props.options.length} ${props.filter}, of ${props.total}` : `${props.options.length} ways to get there`}
        badge={live ? <Status tone={props.held ? "wait" : "alert"}>{props.held ? "Seats held · 5 min" : "Holds released"}</Status> : null}
      />
      <CardContent className="@container grid gap-3.5">
        <Segments name="filter" label="Show" value={only} onChange={setOnly} items={FILTERS} />
        <ol className="grid gap-1.5">
          {props.options.filter(keep).map((o) => {
            const gone = o.seatsLeft === 0;
            return (
              <li key={o.id}>
                <OptionRow
                  dataKey={`option:${o.id}`}
                  button={live && !gone}
                  disabled={sending}
                  picked={o.id === picked}
                  gone={gone}
                  // DECLARED: `choose` is a resolve action
                  onPick={() => ask(o.id, () => send("choose", o.id))}
                  depart={o.depart}
                  arrive={o.arrive}
                  title={`${o.flights.join(" + ")} · ${o.airline}`}
                  detail={`${o.via ? `via ${o.via}` : "Nonstop"} · lands ${later(o.laterMin)} later${o.tonight ? " · leaves tonight" : ""}`}
                  fare={
                    <span className={cn("font-mono font-semibold", !o.extraFare && "font-sans text-[13px] text-hai-good")}>
                      {o.extraFare ? `+$${o.extraFare}` : "No extra cost"}
                    </span>
                  }
                  left={<SeatsLeft n={o.seatsLeft}>{gone ? "Sold out" : `${o.seatsLeft} seats left`}</SeatsLeft>}
                />
              </li>
            );
          })}
        </ol>
        <Foot>
          {!live && state === "frozen"
            ? chosen
              ? `You chose ${chosen.flights.join(" + ")}.`
              : "Closed when you typed instead."
            : "Filters work here, in your browser: no round trip to the model."}
        </Foot>
      </CardContent>
    </Surface>
  );
}
