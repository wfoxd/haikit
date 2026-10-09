/**
 * Notice contracts: what the server can tell a conversation outside of any
 * request. Like the surface contracts, this module crosses the boundary —
 * the server implements and sends these, the browser renders them.
 */

import { defineNotice } from "@haikit/core";
import { z } from "zod";

/** The airline has confirmed the fare hold on the flight the user picked. */
export const holdConfirmed = defineNotice({
  name: "hold_confirmed",
  version: 1,
  payload: z.object({
    flightId: z.string(),
    airline: z.string(),
    date: z.string(),
    depart: z.string(),
    price: z.number(),
    reference: z.string(),
  }),
});

/**
 * The airline has cut the fare on the flight being held. A `wake` notice:
 * the model hears it straight away and tells the user, unasked.
 */
export const fareDropped = defineNotice({
  name: "fare_dropped",
  version: 1,
  kind: "wake",
  payload: z.object({
    flightId: z.string(),
    airline: z.string(),
    was: z.number(),
    now: z.number(),
  }),
});
