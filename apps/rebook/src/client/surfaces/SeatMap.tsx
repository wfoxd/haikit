import { useRef } from "react";
import type { SurfaceProps } from "@haikit/react";
import type { seatMap } from "../../shared/surfaces.ts";
import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
import { useAsk } from "@/lib/ask";
import { useKeepFocus } from "@/lib/focus";
import { useShowTop } from "@/lib/scroll";
import { cn } from "@/lib/utils";
import { Foot, Head, Status, Surface } from "./parts.tsx";

/**
 * The seats on the new flight, or on the flight home. Another passenger takes
 * a seat every few seconds and the map is revised in place: a seat taken
 * under the keyboard hands it to the next free one.
 */
export function SeatMap({ props, send, state, mode, selection }: SurfaceProps<typeof seatMap>) {
  const root = useRef<HTMLDivElement>(null);
  useKeepFocus(root);
  useShowTop(root, state);
  const { sending, picked, ask } = useAsk(state, selection);
  const live = state === "live" && mode === "elicit";
  const free = props.rows.flatMap((r) => r.seats).filter((s) => !s.taken).length;

  return (
    <Surface ref={root}>
      <Head
        title={`Pick a seat on ${props.flight}`}
        sub={`${props.airline} · economy · ${free} free`}
        badge={live ? <Status tone="wait">Other passengers are choosing</Status> : null}
      />
      <CardContent className="grid gap-3.5">
        <div className="grid gap-1 overflow-x-auto">
          {props.rows.map((row) => (
            <div key={row.row} className="flex items-center gap-1">
              <span className="mr-1 w-[2em] text-right font-mono text-xs text-muted-foreground">{row.row}</span>
              {row.seats.map((seat, i) => (
                <span key={seat.id} className="contents">
                  {i === 3 && <span className="w-[18px]" />}
                  <Button
                    variant="outline"
                    data-key={`seat:${seat.id}`}
                    disabled={seat.taken || !live || sending}
                    aria-label={`Seat ${seat.id}${seat.window ? ", window" : ""}${seat.extraLegroom ? ", extra legroom" : ""}${seat.taken ? ", taken" : ""}`}
                    // DECLARED: `pick` is a resolve action
                    onClick={() => ask(seat.id, () => send("pick", seat.id))}
                    className={cn(
                      "size-[30px] bg-secondary p-0 font-mono text-[11.5px] font-semibold disabled:opacity-70 hover:border-primary hover:text-primary",
                      seat.extraLegroom && "border-hai-good/60 text-hai-good",
                      seat.taken && "border-transparent bg-hai-line text-transparent disabled:opacity-100",
                      seat.id === picked && "border-primary bg-primary text-primary-foreground disabled:opacity-100",
                    )}
                  >
                    {seat.letter}
                  </Button>
                </span>
              ))}
            </div>
          ))}
        </div>
        <Foot>
          {state === "frozen"
            ? typeof picked === "string"
              ? `You picked seat ${picked}.`
              : "Closed when you typed instead."
            : "Green seats have extra legroom. Seats go grey as other passengers take them."}
        </Foot>
      </CardContent>
    </Surface>
  );
}
