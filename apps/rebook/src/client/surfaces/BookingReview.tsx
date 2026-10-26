import { useRef } from "react";
import type { SurfaceProps } from "@haikit/react";
import type { bookingReview } from "../../shared/surfaces.ts";
import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
import { useAsk } from "@/lib/ask";
import { useKeepFocus } from "@/lib/focus";
import { dollars } from "@/lib/format";
import { useShowTop } from "@/lib/scroll";
import { Actions, Facts, Foot, Head, Legs, Price, Status, Surface, Why } from "./parts.tsx";

/**
 * Nothing is booked until Confirm. Its click carries the total on screen, so
 * a total the airline has just raised is refused, not charged. The airline
 * raising the fare revises the review in place, and it says so.
 */
export function BookingReview({ props, send, state, mode, selection }: SurfaceProps<typeof bookingReview>) {
  const root = useRef<HTMLDivElement>(null);
  useKeepFocus(root);
  useShowTop(root, state);
  const { sending, picked, ask } = useAsk(state, selection);
  const live = state === "live" && mode === "elicit";
  const raised = props.previousTotal !== null;
  const changes = (["flight", "fare", "seat"] as const).filter((what) => what !== "seat" || props.fare.seatChoice);

  return (
    <Surface ref={root}>
      <Head title="Check your booking" sub="Nothing is booked until you confirm" badge={raised ? <Status tone="alert">Fare went up</Status> : null} />
      <CardContent className="grid gap-3.5">
        <Legs legs={props.legs.map((leg) => ({ from: leg.from, to: leg.to, detail: leg.flight }))} />
        <Facts
          facts={[
            { k: "Traveller", v: props.passenger },
            { k: "Leaves", v: props.depart },
            { k: "Lands", v: props.arrive },
            { k: "Fare", v: props.fare.name },
            { k: "Seat", v: props.seat ?? "At check-in" },
          ]}
        />
        <Price
          raised={raised}
          rows={[
            { k: "Fare", v: dollars(props.price.fare) },
            { k: "Taxes and fees", v: dollars(props.price.taxes) },
            { k: "Total", v: dollars(props.price.total), total: true },
          ]}
        />
        {props.previousTotal !== null && <Why>{`It was ${dollars(props.previousTotal)}: the airline raised the fare a moment ago.`}</Why>}
        <Foot>{props.payment}</Foot>
        {state === "frozen" ? (
          <Foot>
            {picked && typeof picked === "object" && "total" in picked
              ? `You confirmed, at ${dollars(Number((picked as { total: number }).total))}.`
              : typeof picked === "string"
                ? `You asked to change the ${picked}.`
                : "Closed when you typed instead."}
          </Foot>
        ) : (
          <Actions>
            <Button
              size="lg"
              data-key="review:confirm"
              disabled={!live || sending}
              // DECLARED: `confirm` carries the total on screen
              onClick={() => ask({ total: props.price.total }, () => send("confirm", { total: props.price.total }))}
            >
              {`Confirm and book · ${dollars(props.price.total)}`}
            </Button>
            {changes.map((what) => (
              <Button
                key={what}
                size="lg"
                variant="outline"
                data-key={`review:${what}`}
                disabled={!live || sending}
                // DECLARED
                onClick={() => ask(what, () => send("change", what))}
              >
                {`Change ${what}`}
              </Button>
            ))}
          </Actions>
        )}
      </CardContent>
    </Surface>
  );
}
