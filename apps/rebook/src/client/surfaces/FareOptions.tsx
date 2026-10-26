import { useRef } from "react";
import type { SurfaceProps } from "@haikit/react";
import type { fareOptions } from "../../shared/surfaces.ts";
import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
import { useAsk } from "@/lib/ask";
import { useKeepFocus } from "@/lib/focus";
import { DAY_NAMES, dollars } from "@/lib/format";
import { useShowTop } from "@/lib/scroll";
import { cn } from "@/lib/utils";
import { Foot, Head, PICKED, Surface } from "./parts.tsx";

/** The fares on the flight home, side by side. */
export function FareOptions({ props, send, state, mode, selection }: SurfaceProps<typeof fareOptions>) {
  const root = useRef<HTMLDivElement>(null);
  useKeepFocus(root);
  useShowTop(root, state);
  const { sending, picked, ask } = useAsk(state, selection);
  const live = state === "live" && mode === "elicit";
  const chosen = props.fares.find((f) => f.id === picked);

  return (
    <Surface ref={root}>
      <Head title={`Choose a fare on ${props.flight}`} sub={`${props.airline} · ${DAY_NAMES[props.date]} · before taxes`} />
      <CardContent className="grid gap-3.5">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-2">
          {props.fares.map((fare) => (
            <div key={fare.id} className={cn("grid grid-rows-[auto_auto_1fr_auto] gap-1.5 border border-hai-line bg-secondary p-3.5", fare.id === picked && PICKED)}>
              <p className="font-semibold">{fare.name}</p>
              <p className="font-mono text-[22px] font-semibold">{dollars(fare.price)}</p>
              <ul className="mb-1.5 grid content-start gap-1 text-[13px]">
                {fare.includes.map((item) => (
                  <li
                    key={item.text}
                    className={cn("flex gap-[7px]", !item.yes && "text-muted-foreground")}
                    aria-label={`${item.yes ? "Includes" : "Doesn't include"}: ${item.text}`}
                  >
                    <span className={cn("w-[1em] text-center font-bold", item.yes && "text-hai-good")}>{item.yes ? "✓" : "✕"}</span>
                    <span>{item.text}</span>
                  </li>
                ))}
                {!fare.seatChoice && (
                  <li className="flex gap-[7px] text-muted-foreground">
                    <span className="w-[1em] text-center font-bold">·</span>
                    <span>Seat assigned at check-in</span>
                  </li>
                )}
              </ul>
              <Button
                variant={fare.id === "standard" ? "default" : "outline"}
                data-key={`fare:${fare.id}`}
                disabled={!live || sending}
                // DECLARED
                onClick={() => ask(fare.id, () => send("choose", fare.id))}
              >
                {`Choose ${fare.name}`}
              </Button>
            </div>
          ))}
        </div>
        {state === "frozen" && <Foot>{chosen ? `You chose ${chosen.name}, ${dollars(chosen.price)}.` : "Closed when you typed instead."}</Foot>}
      </CardContent>
    </Surface>
  );
}
