import { useRef } from "react";
import type { SurfaceProps } from "@haikit/react";
import type { bookingConfirmed } from "../../shared/surfaces.ts";
import { CardContent } from "@/components/ui/card";
import { dollars } from "@/lib/format";
import { useShowTop } from "@/lib/scroll";
import { Facts, Head, Legs, Status, Surface } from "./parts.tsx";

/** The e-ticket for the flight home. */
export function BookingConfirmed({ props, state }: SurfaceProps<typeof bookingConfirmed>) {
  const root = useRef<HTMLDivElement>(null);
  useShowTop(root, state);
  return (
    <Surface ref={root} className="shadow-[inset_0_4px_0_var(--hai-accent)]">
      <Head title="E-ticket · flight home" sub={`${props.passenger} · booking ${props.reference}`} badge={<Status tone="ok">Booked</Status>} />
      <CardContent className="grid gap-3.5">
        <Legs legs={props.legs.map((leg) => ({ from: leg.from, to: leg.to, detail: leg.flight }))} />
        <Facts
          pass
          facts={[
            { k: "Leaves", v: props.depart },
            { k: "Lands", v: props.arrive },
            { k: "Fare", v: props.fare },
            { k: "Seat", v: props.seat ?? "At check-in" },
            { k: "Bags", v: props.bags },
            { k: "Paid", v: dollars(props.total) },
          ]}
        />
      </CardContent>
    </Surface>
  );
}
