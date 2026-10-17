/**
 * The server halves of the notices. `model` is required, as a surface's
 * digest is: it is all the model ever hears of a notice.
 */

import { flightCancelled, seatConfirmed, ticketIssued } from "../shared/notices.ts";

// A wake notice: the turn it starts is the model's answer to it, so model()
// must return text.
export const flightCancelledServer = flightCancelled.implement({
  model: (p) => `${p.flight}, leaving San Francisco ${p.depart} for Tokyo, was cancelled because of ${p.reason}. The traveller hasn't been told yet.`,
});

export const seatConfirmedServer = seatConfirmed.implement({
  model: (p) => `The airline confirmed seat ${p.seat} on ${p.flight}. The new booking reference is ${p.reference}.`,
});

export const ticketIssuedServer = ticketIssued.implement({
  model: (p) => `The airline issued ticket ${p.ticket} for booking ${p.reference}, ${p.flight}.`,
});

export const notices = [flightCancelledServer, seatConfirmedServer, ticketIssuedServer];
