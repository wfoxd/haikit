/**
 * Surface contracts.
 *
 * THE module that crosses the server/client boundary. The server calls
 * `.implement()` on these; the browser components render against the same prop
 * types. Nothing else is shared — no handlers, no registry, no runtime.
 */

import { defineSurface, inform, query, resolve } from "@haikit/core";
import { z } from "zod";

export const Flight = z.object({
  id: z.string(),
  airline: z.string(),
  depart: z.string(),
  departMin: z.number(),
  arrive: z.string(),
  durationMin: z.number(),
  duration: z.string(),
  stops: z.number(),
  price: z.number(),
  cabin: z.string(),
});
export type Flight = z.infer<typeof Flight>;

export const flightTable = defineSurface({
  name: "flight_table",
  version: 1,
  props: z.object({
    origin: z.string(),
    destination: z.string(),
    date: z.string(),
    flights: z.array(Flight),
  }),

  // Declaring an action is the ONLY way to make it reach the server.
  // Sorting and expanding are absent on purpose: they are component-local, and
  // a table that costs a model round trip to sort feels broken.
  actions: {
    select: resolve(z.string()),
  },

  queries: {
    filter: query(
      z.object({
        maxPrice: z.number().optional(),
        nonstop: z.boolean().optional(),
        airline: z.string().optional(),
      }),
      "Flights matching price / stop / airline constraints",
    ),
    cheapest: query(z.object({ nonstop: z.boolean().optional() }), "The single cheapest flight"),
  },
});

export const seatMap = defineSurface({
  name: "seat_map",
  version: 1,
  props: z.object({
    flightId: z.string(),
    airline: z.string(),
    rows: z.array(
      z.object({
        row: z.number(),
        seats: z.array(
          z.object({
            id: z.string(),
            letter: z.string(),
            taken: z.boolean(),
            extraLegroom: z.boolean(),
            window: z.boolean(),
          }),
        ),
      }),
    ),
  }),
  actions: {
    // `inform` enriches the conversation without ever having blocked it.
    pick: inform(z.object({ id: z.string() })),
  },
});
