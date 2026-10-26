/**
 * The notices. A notice component has no `send`: it shows what the airline
 * said, and nothing in it reaches back. The transcript frames a notice too: a
 * notice is its line.
 */

import type { NoticeProps } from "@haikit/react";
import type { flightCancelled, seatConfirmed, ticketIssued } from "../shared/notices.ts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

/** What the airline said, in orange for a disruption or green for something settled. */
function Line({ tone, title, detail }: { tone: "alert" | "ok"; title: string; detail: string }) {
  return (
    // the transcript says it; the line needn't interrupt with it
    <Alert
      role={undefined}
      className={cn(
        "flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-none border-0 px-3.5 py-2.5 text-sm",
        tone === "alert" ? "bg-hai-bad/10" : "bg-hai-good/10",
      )}
    >
      <AlertTitle className={cn("font-mono font-semibold", tone === "alert" ? "text-hai-bad" : "text-hai-good")}>{title}</AlertTitle>
      <AlertDescription className="text-sm text-muted-foreground">{detail}</AlertDescription>
    </Alert>
  );
}

export function FlightCancelled({ payload: p }: NoticeProps<typeof flightCancelled>) {
  return <Line tone="alert" title={`${p.flight} cancelled`} detail={`${p.depart} · because of ${p.reason}`} />;
}

export function SeatConfirmed({ payload: p }: NoticeProps<typeof seatConfirmed>) {
  return <Line tone="ok" title={`Seat ${p.seat} confirmed`} detail={`${p.flight} · booking ${p.reference}`} />;
}

export function TicketIssued({ payload: p }: NoticeProps<typeof ticketIssued>) {
  return <Line tone="ok" title="Ticket issued" detail={`${p.ticket} · ${p.flight} · booking ${p.reference}`} />;
}
