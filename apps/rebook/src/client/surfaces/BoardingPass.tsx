import { useRef, useState } from "react";
import type { SurfaceProps } from "@haikit/react";
import type { boardingPass } from "../../shared/surfaces.ts";
import { CardContent } from "@/components/ui/card";
import { useShowTop } from "@/lib/scroll";
import { Facts, Foot, Head, Legs, Status, Surface, Why } from "./parts.tsx";

/** The boarding pass: a tear line between the trip and the details. */
export function BoardingPass({ props, state }: SurfaceProps<typeof boardingPass>) {
  const root = useRef<HTMLDivElement>(null);
  useShowTop(root, state);
  // The airline moved the gate: the pass is revised in place, and says so.
  // The gate before the latest revision, while it's news.
  const [gate, setGate] = useState(props.gate);
  const [movedFrom, setMovedFrom] = useState<string | null>(null);
  if (props.gate !== gate) {
    setMovedFrom(gate);
    setGate(props.gate);
  }

  return (
    <Surface ref={root} className="shadow-[inset_0_4px_0_var(--hai-accent)]">
      <Head title="Boarding pass" sub={`${props.passenger} · booking ${props.reference}`} badge={<Status tone="ok">Booked</Status>} />
      <CardContent className="grid gap-3.5">
        <Legs legs={props.legs.map((leg) => ({ from: leg.from, to: leg.to, detail: `${leg.flight} · ${leg.depart}` }))} />
        <Facts
          pass
          facts={[
            // a new key for each gate, so the mark runs again when it moves again
            { k: "Gate", v: props.gate, moved: movedFrom !== null, key: `gate:${props.gate}` },
            { k: "Boards", v: props.boards },
            { k: "Seat", v: props.seat },
            { k: "Lands", v: props.arrive },
          ]}
        />
        {movedFrom && <Why>{`Gate changed from ${movedFrom}.`}</Why>}
        {props.care && <Foot>{`Tonight: ${props.care}.`}</Foot>}
      </CardContent>
    </Surface>
  );
}
