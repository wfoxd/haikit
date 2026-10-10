/**
 * Stands in for an airline's booking system. Asking it to hold a fare answers
 * a little later, the way a webhook would, by sending the conversation a
 * notice — the request that asked has long since finished by then. And it
 * reprices fares on a search the user is still looking at, revising the
 * table on screen with `hai.update`.
 */

import type { Notify, Update } from "@haikit/core";
import type { Flight } from "../shared/surfaces.ts";
import { fareDroppedServer, holdConfirmedServer } from "./notices.ts";
import { flightTableServer } from "./surfaces.ts";

/** How long the airline takes to confirm a hold, and to then cut its fare. */
const CONFIRM_MS = 1_500;
const DROP_MS = 4_000;
/** How long after a search is shown the airline reprices a fare on it. */
const REPRICE_MS = 6_000;

let notify: Notify | null = null;
let update: Update | null = null;

/** Called once at startup with `hai.notify` and `hai.update`, which the airline answers through. */
export function connectAirline(send: Notify, revise: Update) {
  notify = send;
  update = revise;
}

type Search = { origin: string; destination: string; date: string; flights: Flight[] };

/**
 * A little after a search is shown, the airline raises the fare on its
 * cheapest nonstop. The table on screen is revised in place: the user keeps
 * their sort, and a pick still waiting goes to the revision. Sent while the
 * search's own request still holds the conversation, it waits for that to
 * finish. Once the user has picked, the table is answered and isn't repriced.
 */
export function watchFares(conversationId: string, handle: string, search: Search) {
  setTimeout(() => {
    const target = search.flights.filter((f) => f.stops === 0).sort((a, b) => a.price - b.price)[0];
    if (!target) return;
    const now = Math.round(target.price * 1.09);
    const flights = search.flights.map((f) => (f.id === target.id ? { ...f, price: now } : f));
    update?.(conversationId, flightTableServer, handle, { ...search, flights }, {
      model: `${target.airline} raised the fare on ${target.id} from $${target.price} to $${now}.`,
    }).catch((err) => {
      if (!/was answered/.test(err.message)) console.error(`reprice for ${conversationId} not sent: ${err.message}`);
    });
  }, REPRICE_MS);
}

/**
 * Ask for a hold on `flight`. The confirmation arrives as a notice beside
 * `handle`, and a little later the airline cuts the held fare, as a wake
 * notice: the model tells the user without being asked.
 */
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
  setTimeout(() => {
    const now = Math.round(flight.price * 0.88);
    notify?.(
      conversationId,
      fareDroppedServer,
      { flightId: flight.id, airline: flight.airline, was: flight.price, now },
      { handle },
    ).catch((err) => console.error(`fare drop for ${conversationId} not sent: ${err.message}`));
  }, DROP_MS);
}
