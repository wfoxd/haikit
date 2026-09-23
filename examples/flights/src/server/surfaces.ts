/**
 * Server halves of the surface contracts.
 *
 * Never reaches the browser. Everything here — digests, action handlers,
 * query accessors — is authored against the same contract the components
 * render from, and TypeScript holds both sides to it.
 */

import type { Flight } from "../shared/surfaces.ts";
import { flightTable, seatMap } from "../shared/surfaces.ts";
import { stopLabel } from "./data.ts";

const fmt = (f: Flight) =>
  `${f.airline} ${f.id} $${f.price} ${f.depart}->${f.arrive} ${f.duration} ${stopLabel(f.stops)}`;

/** Where a chosen row sits relative to the rows the model cannot see. */
function rank(flight: Flight, flights: Flight[]): string {
  const byPrice = [...flights].sort((a, b) => a.price - b.price);
  const byTime = [...flights].sort((a, b) => a.durationMin - b.durationMin);
  const nonstops = flights.filter((f) => f.stops === 0).sort((a, b) => a.price - b.price);
  const bits = [
    `#${byPrice.findIndex((f) => f.id === flight.id) + 1} of ${flights.length} by price`,
    `#${byTime.findIndex((f) => f.id === flight.id) + 1} by duration`,
  ];
  if (flight.stops === 0 && nonstops[0]?.id === flight.id) bits.unshift("cheapest nonstop");
  return bits.join(", ");
}

export const flightTableServer = flightTable.implement({
  // Required by the contract. A count and a price range would compile, but it
  // is the lazy version — the model would narrate "cheapest nonstop" about rows
  // it never received. Precompute what the next turn or two will need.
  digest(props, { handle }) {
    const byPrice = [...props.flights].sort((a, b) => a.price - b.price);
    const nonstops = props.flights.filter((f) => f.stops === 0);
    const cheapestNonstop = [...nonstops].sort((a, b) => a.price - b.price)[0];
    const fastest = [...props.flights].sort((a, b) => a.durationMin - b.durationMin)[0]!;

    return [
      `${props.flights.length} flights ${props.origin}->${props.destination} ${props.date}, $${byPrice[0]!.price}-$${byPrice.at(-1)!.price}.`,
      `Cheapest: ${fmt(byPrice[0]!)}.`,
      cheapestNonstop ? `Cheapest nonstop: ${fmt(cheapestNonstop)}.` : "No nonstops available.",
      `Fastest: ${fmt(fastest)}.`,
      `${nonstops.length} nonstop / ${props.flights.length - nonstops.length} with stops.`,
      `Rendered as ${handle}.`,
    ].join(" ");
  },

  actions: {
    // Interactions are the cheapest precision you will ever buy — this is ONE
    // row, so be generous. The rank line is what lets the model comment
    // intelligently about a board it cannot see.
    select(flightId, { props }) {
      const f = props.flights.find((x) => x.id === flightId);
      if (!f) return `Selection failed: unknown flight ${flightId}.`;
      return (
        `Selected: ${f.airline} ${f.id}, ${props.origin} ${f.depart} -> ${props.destination} ${f.arrive}, ` +
        `${stopLabel(f.stops)}, ${f.duration}, $${f.price}. Rank: ${rank(f, props.flights)}.`
      );
    },
  },

  queries: {
    // `cap` is the only way to produce the return type. Sort BEFORE capping —
    // an unsorted cap returns an arbitrary 8, which misleads as badly as
    // silent truncation.
    filter(args, { props, cap }) {
      const rows = props.flights
        .filter((f) => (args.nonstop ? f.stops === 0 : true))
        .filter((f) => (args.maxPrice != null ? f.price <= args.maxPrice : true))
        .filter((f) =>
          args.airline ? f.airline.toLowerCase().includes(args.airline.toLowerCase()) : true,
        )
        .sort((a, b) => a.price - b.price);
      return cap(rows, fmt);
    },

    cheapest(args, { props, cap }) {
      const rows = [...props.flights]
        .filter((f) => (args.nonstop ? f.stops === 0 : true))
        .sort((a, b) => a.price - b.price);
      return cap(rows.slice(0, 1), fmt);
    },
  },
});

export const seatMapServer = seatMap.implement({
  digest(props, { handle }) {
    const seats = props.rows.flatMap((r) => r.seats);
    const free = seats.filter((s) => !s.taken);
    return (
      `Seat map for ${props.airline} ${props.flightId} rendered as ${handle}. ` +
      `${free.length} of ${seats.length} seats free, rows 20-31. Extra legroom rows: 20, 26.`
    );
  },

  actions: {
    pick(value, { props }) {
      const seat = props.rows.flatMap((r) => r.seats).find((s) => s.id === value.id);
      if (!seat) return `Unknown seat ${value.id}.`;
      const traits = [seat.window ? "window" : "aisle/middle", seat.extraLegroom ? "extra legroom" : null]
        .filter(Boolean)
        .join(", ");
      return `Picked seat ${seat.id} on ${props.flightId} (${traits}).`;
    },
  },

  queries: {},
});
