/**
 * The contracts for Rebook's surfaces: five for rebooking a cancelled flight,
 * and five for booking the flight home. Both halves import this file: the
 * server implements it in ../server/surfaces.ts, and the browser renders it in
 * ../../public/components.js, typechecked against the types below.
 *
 * Nothing here says how a surface looks or what its digest is. A contract is
 * what may cross between the halves: the props, the actions a click may send,
 * and the queries the model may run.
 */

import { defineSurface, inform, query, resolve, type Infer } from "@haikit/core";
import { z } from "zod";

/** The booking the traveller starts with. */
export const tripCard = defineSurface({
  name: "trip_card",
  // 2 added the flight home, and the button that books it
  version: 2,
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
    /** The flight home, once it's booked: the card is revised to show it. */
    home: z.object({ flight: z.string(), depart: z.string(), reference: z.string() }).nullable(),
  }),
  // Something shown, not something asked: nothing waits on it. Its one button
  // tells the guide the traveller wants to book the flight home, and the guide
  // takes it from there.
  actions: {
    book_home: inform(z.literal("home")),
  },
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
  // 2 added the purpose: the same map picks a seat on the flight home
  version: 2,
  props: z.object({
    /** Rebooking the cancelled flight, or booking the flight home. */
    purpose: z.enum(["rebook", "book"]),
    /** The rebooking option (o05) or the flight home (r01) the seat is on. */
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

/**
 * The change to check before it's booked, when the option chosen costs extra:
 * the new flight, the seat, tonight, and the extra fare. Nothing is booked
 * until Confirm, whose click carries the amount on screen, so the traveller
 * pays exactly what they saw. An option at no extra cost needs no review: its
 * clicks book it.
 */
export const rebookingReview = defineSurface({
  name: "rebooking_review",
  version: 1,
  props: z.object({
    passenger: z.string(),
    /** The cancelled flight this replaces. */
    cancelled: z.string(),
    optionId: z.string(),
    flight: z.string(),
    airline: z.string(),
    legs: z.array(z.object({ flight: z.string(), from: z.string(), to: z.string() })),
    depart: z.string(),
    arrive: z.string(),
    seat: z.string(),
    /** Where the traveller spends tonight, when there is a night to spend. */
    care: z.string().nullable(),
    /** What the new flight costs on top of the ticket the traveller has, in dollars. */
    extraFare: z.number(),
    /** How it's paid for, in words. A demo: no card details are ever asked for. */
    payment: z.string(),
  }),
  actions: {
    confirm: resolve(z.object({ extraFare: z.number() })),
    change: resolve(z.enum(["flight", "seat"])),
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

// ───────────────────────────────────────────── booking the flight home

/** The days the flight home can leave Tokyo: the outbound lands on Wednesday night. */
export const Day = z.enum(["Thu", "Fri", "Sat", "Sun", "Mon"]);
export type Day = z.infer<typeof Day>;
/** Either Tokyo airport, Narita, or Haneda. */
export const TokyoAirport = z.enum(["TYO", "NRT", "HND"]);
export type TokyoAirport = z.infer<typeof TokyoAirport>;

/**
 * The search for the flight home, filled in from what the guide already
 * knows: the traveller and the airports from the trip, the day from what
 * they said. Changing the day or the airport stays in the browser until
 * Search sends the whole search as one value.
 */
export const flightSearch = defineSurface({
  name: "flight_search",
  version: 1,
  props: z.object({
    passenger: z.string(),
    from: TokyoAirport,
    to: z.object({ code: z.string(), city: z.string() }),
    /** The day to fly, or null when the traveller hasn't said: then they choose. */
    date: Day.nullable(),
    days: z.array(z.object({ id: Day, nights: z.number() })),
    /** Where each value came from, shown beside it; null for a day still to choose. */
    sources: z.object({ passenger: z.string(), from: z.string(), to: z.string(), date: z.string().nullable() }),
  }),
  actions: {
    search: resolve(z.object({ from: TokyoAirport, date: Day })),
  },
});

/** One flight home, Tokyo to San Francisco. */
export const HomeFlight = z.object({
  id: z.string(),
  flights: z.array(z.string()),
  airline: z.string(),
  from: z.enum(["NRT", "HND"]),
  /** Where the change is, or null for a nonstop. */
  via: z.string().nullable(),
  /** Tokyo time. */
  depart: z.string(),
  /** San Francisco time: across the date line, the same day it left. */
  arrive: z.string(),
  durationMin: z.number(),
  /** The Basic fare, before taxes. */
  price: z.number(),
  seatsLeft: z.number(),
});
export type HomeFlight = z.infer<typeof HomeFlight>;

export const flightResults = defineSurface({
  name: "flight_results",
  version: 1,
  props: z.object({
    // the first array prop: what query_ui counts its matches against
    flights: z.array(HomeFlight),
    date: Day,
    from: TokyoAirport,
    /** How many flights there are before a filter. */
    total: z.number(),
    /** What the guide filtered the flights to, in words, or null for all of them. */
    filter: z.string().nullable(),
  }),
  actions: {
    choose: resolve(z.string()),
  },
  queries: {
    filter: query(
      z.object({
        nonstop: z.boolean().optional(),
        airport: z.enum(["NRT", "HND"]).optional(),
        maxPrice: z.number().optional(),
        airline: z.string().optional(),
      }),
      "Flights matching stops, Tokyo airport, a top price or airline, earliest departure first",
      {
        type: "object",
        properties: {
          nonstop: { type: "boolean", description: "true for nonstops only" },
          airport: { type: "string", enum: ["NRT", "HND"], description: "leave from Narita (NRT) or Haneda (HND)" },
          maxPrice: { type: "number", description: "the most the Basic fare may cost, in dollars" },
          airline: { type: "string", description: "an airline's name, e.g. ANA" },
        },
      },
    ),
    cheapest: query(z.object({}), "The flight with the lowest fare", { type: "object", properties: {} }),
  },
});

export const FareId = z.enum(["basic", "standard", "flex"]);
export type FareId = z.infer<typeof FareId>;
export const Fare = z.object({
  id: FareId,
  name: z.string(),
  /** Before taxes. */
  price: z.number(),
  /** Whether this fare lets the traveller choose a seat now. */
  seatChoice: z.boolean(),
  includes: z.array(z.object({ text: z.string(), yes: z.boolean() })),
});
export type Fare = z.infer<typeof Fare>;

export const fareOptions = defineSurface({
  name: "fare_options",
  version: 1,
  props: z.object({
    flightId: z.string(),
    flight: z.string(),
    airline: z.string(),
    date: Day,
    fares: z.array(Fare),
  }),
  actions: {
    choose: resolve(FareId),
  },
});

/**
 * The booking, for the traveller to check before anything is booked. Confirm
 * sends the total they saw, so a click on a total that has just changed is
 * refused rather than charged.
 */
export const bookingReview = defineSurface({
  name: "booking_review",
  version: 1,
  props: z.object({
    passenger: z.string(),
    flightId: z.string(),
    airline: z.string(),
    legs: z.array(z.object({ flight: z.string(), from: z.string(), to: z.string() })),
    depart: z.string(),
    arrive: z.string(),
    fare: z.object({ id: FareId, name: z.string(), seatChoice: z.boolean() }),
    /** The seat picked, or null when the fare assigns one at check-in. */
    seat: z.string().nullable(),
    price: z.object({ fare: z.number(), taxes: z.number(), total: z.number() }),
    /** The total before the airline raised the fare, while that's news; else null. */
    previousTotal: z.number().nullable(),
    /** How it's paid for, in words. A demo: no card details are ever asked for. */
    payment: z.string(),
  }),
  actions: {
    confirm: resolve(z.object({ total: z.number() })),
    change: resolve(z.enum(["flight", "fare", "seat"])),
  },
});

export const bookingConfirmed = defineSurface({
  name: "booking_confirmed",
  version: 1,
  props: z.object({
    passenger: z.string(),
    reference: z.string(),
    legs: z.array(z.object({ flight: z.string(), from: z.string(), to: z.string() })),
    depart: z.string(),
    arrive: z.string(),
    fare: z.string(),
    seat: z.string().nullable(),
    bags: z.string(),
    total: z.number(),
  }),
  actions: {},
});

export type TripCardProps = Infer<typeof tripCard.props>;
export type RebookingOptionsProps = Infer<typeof rebookingOptions.props>;
export type SeatMapProps = Infer<typeof seatMap.props>;
export type CareOptionsProps = Infer<typeof careOptions.props>;
export type RebookingReviewProps = Infer<typeof rebookingReview.props>;
export type BoardingPassProps = Infer<typeof boardingPass.props>;
export type FlightSearchProps = Infer<typeof flightSearch.props>;
export type FlightResultsProps = Infer<typeof flightResults.props>;
export type FareOptionsProps = Infer<typeof fareOptions.props>;
export type BookingReviewProps = Infer<typeof bookingReview.props>;
export type BookingConfirmedProps = Infer<typeof bookingConfirmed.props>;
