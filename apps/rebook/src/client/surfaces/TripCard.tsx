import { useRef, useState } from "react";
import type { SurfaceProps } from "@haikit/react";
import type { tripCard } from "../../shared/surfaces.ts";
import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
import { useKeepFocus } from "@/lib/focus";
import { cn } from "@/lib/utils";
import { Arrow, CODE, Facts, Head, LABEL, Status, Surface, TIME, Why } from "./parts.tsx";

/**
 * The booking the traveller starts with. The airline revises it in place when
 * it cancels the flight, and when the flight home is booked.
 */
export function TripCard({ props, send, state }: SurfaceProps<typeof tripCard>) {
  const root = useRef<HTMLDivElement>(null);
  useKeepFocus(root);
  const [sending, setSending] = useState(false);
  const cancelled = props.status === "cancelled";

  // DECLARED: `book_home` is an inform action. It tells the guide, which
  // starts the booking; nothing waits on this card. A click the server
  // refuses, such as one while a question waits, resolves all the same, so
  // the button stays: the card is revised once the flight is booked.
  const bookHome = async () => {
    setSending(true);
    try {
      await send("book_home", "home");
    } catch (err) {
      console.error("[rebook] the click wasn't sent:", err);
    } finally {
      setSending(false);
    }
  };

  return (
    <Surface ref={root} className={cn(cancelled && "shadow-[inset_4px_0_0_var(--hai-bad)]")}>
      <Head
        title="Your trip"
        sub={`${props.passenger} · booking ${props.reference}`}
        badge={cancelled ? <Status tone="alert">Cancelled</Status> : <Status tone="ok">On time</Status>}
      />
      <CardContent className="grid gap-3.5">
        <div className={cn("flex items-center gap-[18px]", cancelled && "opacity-55")}>
          {([[props.from, props.depart], null, [props.to, props.arrive]] as const).map((stop, i) =>
            stop ? (
              <div key={i} className="grid gap-[3px]">
                <span className={CODE}>{stop[0].code}</span>
                <span className="text-[13px] text-muted-foreground">{stop[0].city}</span>
                <span className={cn(TIME, cancelled && "line-through")}>{stop[1]}</span>
              </div>
            ) : (
              <Arrow key={i} className="text-[22px]" />
            ),
          )}
        </div>
        <Facts
          facts={[
            { k: "Flight", v: `${props.airline} ${props.flight}` },
            { k: "Seat", v: props.seat },
          ]}
        />
        {cancelled && props.reason && <Why>{`Cancelled because of ${props.reason}.`}</Why>}
        {/* the flight home: booked, or a button that asks the guide to book it */}
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 border-t border-hai-line pt-3">
          <span className={LABEL}>Flight home</span>
          <span className="flex-auto font-mono font-semibold">
            {props.home ? `${props.home.flight} · ${props.home.depart} · booking ${props.home.reference}` : "Not booked yet"}
          </span>
          {!props.home && (
            <Button variant="outline" size="sm" data-key="home:book" disabled={sending || state !== "live"} onClick={bookHome}>
              Book my flight home
            </Button>
          )}
        </div>
      </CardContent>
    </Surface>
  );
}
