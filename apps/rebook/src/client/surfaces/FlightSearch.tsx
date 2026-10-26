import { useRef, useState, type ReactNode } from "react";
import type { SurfaceProps } from "@haikit/react";
import type { Day, TokyoAirport, flightSearch } from "../../shared/surfaces.ts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
import { useAsk } from "@/lib/ask";
import { useKeepFocus } from "@/lib/focus";
import { AIRPORTS, DAY_NAMES, FROM } from "@/lib/format";
import { useShowTop } from "@/lib/scroll";
import { cn } from "@/lib/utils";
import { Foot, Head, LABEL, Segments, Surface } from "./parts.tsx";

const AIRPORT_IDS: TokyoAirport[] = ["TYO", "NRT", "HND"];

/**
 * One value of the search, beside where it came from. In a narrow card the
 * value goes on a line of its own, under its label and source.
 */
function Field({ label, source, children }: { label: string; source: string | null; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5em_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 @max-[480px]:grid-cols-[minmax(0,1fr)_auto]">
      <span className={LABEL}>{label}</span>
      <div className="min-w-0 @max-[480px]:col-span-full @max-[480px]:row-start-2">{children}</div>
      <Badge className={cn("justify-self-end", source ? "bg-hai-good/12 font-normal text-hai-good" : "bg-hai-warn/15 font-semibold text-hai-warn")}>
        {source ? `from ${source}` : "choose one"}
      </Badge>
    </div>
  );
}

/**
 * The search, filled in from what the guide knows. Changing the day or the
 * airport is LOCAL: it stays here until Search sends the whole search
 * through the declared `search` action.
 */
export function FlightSearch({ props, send, state, mode, selection }: SurfaceProps<typeof flightSearch>) {
  const root = useRef<HTMLDivElement>(null);
  useKeepFocus(root);
  useShowTop(root, state);
  const { sending, picked, ask } = useAsk(state, selection);
  const [from, setFrom] = useState<TokyoAirport>(props.from);
  const [date, setDate] = useState<Day | null>(props.date);
  const live = state === "live" && mode === "elicit";
  const searched = picked as { from?: TokyoAirport; date?: Day } | undefined;

  return (
    <Surface ref={root}>
      <Head title="Book your flight home" sub="Filled in from what Rebook already knows. Change anything, then search." />
      <CardContent className="@container grid gap-3.5">
        <div className="grid gap-2.5">
          <Field label="Traveller" source={props.sources.passenger}>
            <span className="font-mono text-[15px] font-semibold">{props.passenger}</span>
          </Field>
          <Field label="From" source={from === props.from ? props.sources.from : "you"}>
            <Segments
              name="from"
              label="From"
              value={from}
              onChange={setFrom} // LOCAL
              items={AIRPORT_IDS.map((id) => ({ value: id, label: AIRPORTS[id] }))}
              disabled={!live || sending}
            />
          </Field>
          <Field label="To" source={props.sources.to}>
            <span className="font-mono text-[15px] font-semibold">{`${props.to.city} · ${props.to.code}`}</span>
          </Field>
          <Field label="Day" source={date === null ? null : date === props.date ? props.sources.date : "you"}>
            <Segments
              name="day"
              label="Day"
              value={date}
              onChange={setDate} // LOCAL
              items={props.days.map((d) => ({
                value: d.id,
                label: (
                  <>
                    <span>{d.id}</span>
                    <span className="text-[11px] font-normal text-muted-foreground">{`${d.nights} night${d.nights === 1 ? "" : "s"}`}</span>
                  </>
                ),
              }))}
              disabled={!live || sending}
              itemClassName="h-auto min-w-[4.4em] flex-col gap-0 px-2.5 py-1"
            />
          </Field>
        </div>
        {state === "frozen" ? (
          <Foot>
            {searched?.date && searched.from
              ? `You searched from ${FROM[searched.from]} to San Francisco on ${DAY_NAMES[searched.date]}.`
              : "Closed when you typed instead."}
          </Foot>
        ) : (
          <Button
            size="lg"
            className="justify-self-start"
            data-key="search:go"
            disabled={!live || sending || !date}
            // DECLARED: `search` is a resolve action
            onClick={() => date && ask({ from, date }, () => send("search", { from, date }))}
          >
            {date ? `Search flights on ${DAY_NAMES[date]}` : "Choose a day to search"}
          </Button>
        )}
      </CardContent>
    </Surface>
  );
}
