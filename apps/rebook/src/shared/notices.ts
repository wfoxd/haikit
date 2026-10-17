/**
 * What the airline tells a conversation outside any request. Like the surface
 * contracts, this module crosses the boundary: the server sends these, the
 * browser renders them.
 */

import { defineNotice } from "@haikit/core";
import { z } from "zod";

/**
 * The airline cancelled the flight. A `wake` notice: the guide hears it at
 * once and tells the traveller, who hasn't said anything yet.
 */
export const flightCancelled = defineNotice({
  name: "flight_cancelled",
  version: 1,
  kind: "wake",
  payload: z.object({ flight: z.string(), depart: z.string(), reason: z.string() }),
});

/** The airline confirmed the seat on the new flight, a moment after booking it, the way a webhook would. */
export const seatConfirmed = defineNotice({
  name: "seat_confirmed",
  version: 1,
  payload: z.object({ flight: z.string(), seat: z.string(), reference: z.string() }),
});

/** The airline issued the ticket for the flight home, a moment after it was booked. */
export const ticketIssued = defineNotice({
  name: "ticket_issued",
  version: 1,
  payload: z.object({ reference: z.string(), ticket: z.string(), flight: z.string() }),
});
