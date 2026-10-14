/**
 * The contracts for Rebook's five surfaces. Both halves import this file: the
 * server implements it in ../server/surfaces.ts, and the browser renders it in
 * ../../public/components.js, typechecked against the types below.
 *
 * Nothing here says how a surface looks or what its digest is. A contract is
 * what may cross between the halves: the props, the actions a click may send,
 * and the queries the model may run.
 */

import { defineSurface, query, resolve, type Infer } from "@haikit/core";
import { z } from "zod";

/** The booking the traveller starts with. */
export const tripCard = defineSurface({
  name: "trip_card",
  version: 1,
  props: z.object({
    passenger: z.string(),
    reference: z.string(),
    flight: z.string(),
    airline: z.string(),
    from: z.object({ code: z.string(), city: z.string() }),
    to: z.object({ code: z.string(), city: z.string() }),
    /** San Francisco time, then Tokyo time. */
    depart: z.string(),
    arrive: z.string(),
    seat: z.string(),
    /** The airline revises the card when it cancels the flight. */
    status: z.enum(["on-time", "cancelled"]),
    reason: z.string().nullable(),
  }),
  // Something shown, not something asked: nothing on it can reach the server.
  actions: {},
});

/** One way to get there instead. */
export const RebookOption = z.object({
  id: z.string(),
  /** Each leg's flight number: one for a nonstop, two with a change. */
  flights: z.array(z.string()),
  airline: z.string(),
  /** Where the change is, or null for a nonstop. */
  via: z.string().nullable(),
  to: z.enum(["NRT", "HND"]),
  /** San Francisco time. */
  depart: z.string(),
  /** It leaves this evening, so there's no night to spend in San Francisco. */
  tonight: z.boolean(),
  /** Tokyo time. */
  arrive: z.string(),
  /** How much later than the cancelled flight it lands, in minutes. */
  laterMin: z.number(),
  /** What it costs beyond the ticket: 0 when the airline covers it. */
  extraFare: z.number(),
  seatsLeft: z.number(),
});
export type RebookOption = z.infer<typeof RebookOption>;

export const rebookingOptions = defineSurface({
  name: "rebooking_options",
  version: 1,
  props: z.object({
    /** The cancelled flight these replace. */
    cancelled: z.string(),
    // First array prop on purpose: query_ui reports "N of TOTAL match"
    // against the first array in the props, and the options are what's queried.
    options: z.array(RebookOption),
    /** How many options there are before a filter: the picker may show fewer. */
    total: z.number(),
    /** What the guide filtered the options to, in words, or null for all of them. */
    filter: z.string().nullable(),
    /** Whether the airline is still holding a seat on each for the traveller. */
    held: z.boolean(),
  }),
  actions: {
    // The click is the answer: the turn waits on it.
    choose: resolve(z.string()),
  },
  queries: {
    filter: query(
      z.object({
        nonstop: z.boolean().optional(),
        noExtraFare: z.boolean().optional(),
        tonight: z.boolean().optional(),
        airline: z.string().optional(),
      }),
      "Options matching stops, extra fare, leaving tonight or airline, earliest arrival first",
      {
        type: "object",
        properties: {
          nonstop: { type: "boolean", description: "true for nonstops only" },
          noExtraFare: { type: "boolean", description: "true for options at no extra cost" },
          tonight: { type: "boolean", description: "true for options leaving this evening" },
          airline: { type: "string", description: "an airline's name, e.g. ANA" },
        },
      },
    ),
    earliest: query(z.object({}), "The option that lands first", { type: "object", properties: {} }),
  },
});

export const Seat = z.object({
  id: z.string(),
  letter: z.string(),
  taken: z.boolean(),
  window: z.boolean(),
  extraLegroom: z.boolean(),
});

export const seatMap = defineSurface({
  name: "seat_map",
  version: 1,
  props: z.object({
    optionId: z.string(),
    flight: z.string(),
    airline: z.string(),
    rows: z.array(z.object({ row: z.number(), seats: z.array(Seat) })),
  }),
  actions: {
    // A seat is the answer. One taken a moment ago is refused, and the map
    // stays live for another pick.
    pick: resolve(z.string()),
  },
});

export const careOptions = defineSurface({
  name: "care_options",
  version: 1,
  props: z.object({
    /** The night to cover: the new flight leaves tomorrow. */
    night: z.string(),
    flight: z.string(),
    choices: z.array(z.object({ id: z.enum(["hotel", "lounge", "none"]), title: z.string(), detail: z.string() })),
  }),
  actions: {
    choose: resolve(z.enum(["hotel", "lounge", "none"])),
  },
});

export const boardingPass = defineSurface({
  name: "boarding_pass",
  version: 1,
  props: z.object({
    passenger: z.string(),
    reference: z.string(),
    flight: z.string(),
    airline: z.string(),
    /** Each leg, in order. */
    legs: z.array(z.object({ flight: z.string(), from: z.string(), to: z.string(), depart: z.string() })),
    arrive: z.string(),
    seat: z.string(),
    /** The airline revises the pass when the gate changes. */
    gate: z.string(),
    boards: z.string(),
    /** Where the traveller spends tonight, when there is a night to spend. */
    care: z.string().nullable(),
  }),
  actions: {},
});

export type TripCardProps = Infer<typeof tripCard.props>;
export type RebookingOptionsProps = Infer<typeof rebookingOptions.props>;
export type SeatMapProps = Infer<typeof seatMap.props>;
export type CareOptionsProps = Infer<typeof careOptions.props>;
export type BoardingPassProps = Infer<typeof boardingPass.props>;
