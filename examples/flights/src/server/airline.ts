/**
 * Stands in for an airline's booking system. Asking it to hold a fare answers
 * a little later, the way a webhook would, by sending the conversation a
 * notice — the request that asked has long since finished by then.
 */

import type { Notify } from "@haikit/core";
import type { Flight } from "../shared/surfaces.ts";
import { holdConfirmedServer } from "./notices.ts";

/** How long the airline takes to confirm a hold. */
const CONFIRM_MS = 1_500;

let notify: Notify | null = null;

/** Called once at startup with `hai.notify`, which the airline answers through. */
export function connectAirline(send: Notify) {
  notify = send;
}

/** Ask for a hold on `flight`. The confirmation arrives as a notice beside `handle`. */
export function requestHold(conversationId: string, handle: string, flight: Flight, date: string) {
  const reference = Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
  setTimeout(() => {
    notify?.(
      conversationId,
      holdConfirmedServer,
      { flightId: flight.id, airline: flight.airline, date, depart: flight.depart, price: flight.price, reference },
      { handle },
    ).catch((err) => console.error(`hold confirmation for ${conversationId} not sent: ${err.message}`));
  }, CONFIRM_MS);
}
