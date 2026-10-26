import { useRef } from "react";
import type { SurfaceProps } from "@haikit/react";
import type { rebookingReview } from "../../shared/surfaces.ts";
import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
import { useAsk } from "@/lib/ask";
import { useKeepFocus } from "@/lib/focus";
import { dollars } from "@/lib/format";
import { useShowTop } from "@/lib/scroll";
import { Actions, Facts, Foot, Head, Legs, Price, Status, Surface } from "./parts.tsx";

const CHANGES = [
  ["flight", "Different flight"],
  ["seat", "Different seat"],
] as const;

/**
 * Shown only when the new flight costs extra. Nothing is booked until
 * Confirm, whose click carries the extra fare on screen: the traveller pays
 * exactly what they saw.
 */
export function RebookingReview({ props, send, state, mode, selection }: SurfaceProps<typeof rebookingReview>) {
  const root = useRef<HTMLDivElement>(null);
  useKeepFocus(root);
  useShowTop(root, state);
  const { sending, picked, ask } = useAsk(state, selection);
  const live = state === "live" && mode === "elicit";
  const facts = [
    { k: "Traveller", v: props.passenger },
    { k: "Leaves", v: props.depart },
    { k: "Lands", v: props.arrive },
    { k: "Seat", v: props.seat },
  ];
  if (props.care) facts.push({ k: "Tonight", v: props.care.split(":")[0] ?? props.care });

  return (
    <Surface ref={root}>
      <Head
        title="Check your new flight"
        sub={`Instead of ${props.cancelled}. Nothing is booked until you confirm`}
        badge={<Status tone="wait">{`${dollars(props.extraFare)} extra`}</Status>}
      />
      <CardContent className="grid gap-3.5">
        <Legs legs={props.legs.map((leg) => ({ from: leg.from, to: leg.to, detail: leg.flight }))} />
        <Facts facts={facts} />
        <Price rows={[{ k: `Extra fare, on top of your ${props.cancelled} ticket`, v: dollars(props.extraFare), total: true }]} />
        <Foot>{props.payment}</Foot>
        {state === "frozen" ? (
          <Foot>
            {picked && typeof picked === "object" && "extraFare" in picked
              ? `You confirmed, at ${dollars(Number((picked as { extraFare: number }).extraFare))} extra.`
              : picked === "flight"
                ? "You asked for a different flight."
                : picked === "seat"
                  ? "You asked for a different seat."
                  : "Closed when you typed instead."}
          </Foot>
        ) : (
          <Actions>
            <Button
              size="lg"
              data-key="change:confirm"
              disabled={!live || sending}
              // DECLARED: `confirm` carries the extra fare on screen
              onClick={() => ask({ extraFare: props.extraFare }, () => send("confirm", { extraFare: props.extraFare }))}
            >
              {`Confirm and book · ${dollars(props.extraFare)} extra`}
            </Button>
            {CHANGES.map(([what, label]) => (
              <Button
                key={what}
                size="lg"
                variant="outline"
                data-key={`change:${what}`}
                disabled={!live || sending}
                // DECLARED
                onClick={() => ask(what, () => send("change", what))}
              >
                {label}
              </Button>
            ))}
          </Actions>
        )}
      </CardContent>
    </Surface>
  );
}
