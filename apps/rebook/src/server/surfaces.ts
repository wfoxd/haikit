/**
 * The server halves of the surfaces: what the model is told about each, and
 * what a click on it means. This file never reaches the browser.
 */

import type { RebookOption } from "../shared/surfaces.ts";
import { boardingPass, careOptions, rebookingOptions, seatMap, tripCard } from "../shared/surfaces.ts";
import { careChosen, optionChosen, seatPicked } from "./airline.ts";
import { later } from "./data.ts";

/** One option, as the model reads it: everything it needs to talk about it. */
export const fmt = (o: RebookOption) =>
  `${o.flights.join(" + ")} (${o.airline}) ${o.via ? `via ${o.via}` : "nonstop"}, leaves ${o.depart}, ` +
  `lands ${o.to} ${o.arrive} (${later(o.laterMin)} later), ` +
  `${o.extraFare ? `$${o.extraFare} extra` : "no extra cost"}, ${o.seatsLeft ? `${o.seatsLeft} seats left` : "sold out"} [${o.id}]`;

export const tripCardServer = tripCard.implement({
  digest(p, { handle }) {
    const trip = `${p.passenger}, booking ${p.reference}: ${p.airline} ${p.flight}, ${p.from.city} ${p.depart} to ${p.to.city} ${p.arrive}, seat ${p.seat}`;
    return p.status === "cancelled"
      ? `Trip on screen as ${handle}: ${trip}. CANCELLED, because of ${p.reason}.`
      : `Trip on screen as ${handle}: ${trip}. On time.`;
  },
  actions: {},
  queries: {},
});

export const rebookingOptionsServer = rebookingOptions.implement({
  // Prices and seats left change. A conversation still showing these after
  // 20 minutes has gone out of date, and HaiKIT refuses every request on it
  // rather than act on them. The airline's 5-minute holds end long before.
  staleAfterMs: 20 * 60_000,

  // The options are the browser's. The model gets what its next sentence
  // will need: which lands first, which lands first for free, and how many
  // of each kind there are. Anything else, it asks for with query_ui.
  digest(p, { handle }) {
    const open = p.options.filter((o) => o.seatsLeft > 0);
    const first = open[0];
    const firstFree = open.find((o) => o.extraFare === 0);
    const count = (keep: (o: RebookOption) => boolean) => open.filter(keep).length;
    return [
      `Rebooking options for ${p.cancelled}, on screen as ${handle}: ${p.options.length} ways to Tokyo` +
        (p.filter ? ` (${p.filter}, of ${p.total})` : "") +
        (open.length < p.options.length ? `, ${p.options.length - open.length} of them sold out.` : "."),
      first ? `Lands first: ${fmt(first)}.` : "Every one is sold out.",
      firstFree && firstFree !== first ? `Lands first at no extra cost: ${fmt(firstFree)}.` : "",
      `Nonstop: ${count((o) => !o.via)}. No extra cost: ${count((o) => o.extraFare === 0)}. Leaving tonight: ${count((o) => o.tonight)}.`,
      p.held
        ? "The airline holds a seat on each for the traveller for 5 minutes."
        : "The airline has released its holds: seats go to whoever books first.",
      "The traveller picks one; query_ui filter and earliest answer about the rest.",
    ]
      .filter(Boolean)
      .join(" ");
  },

  actions: {
    choose(optionId, { props, conversationId }) {
      const o = props.options.find((x) => x.id === optionId);
      // Throwing refuses the click: nothing is recorded, and the picker stays live.
      if (!o) throw new Error(`no option ${optionId}`);
      if (o.seatsLeft === 0) throw new Error(`${o.flights.join(" + ")} sold out a moment ago: pick another`);
      optionChosen(conversationId, o);
      return (
        `Chose ${o.id}: ${fmt(o)}. ` +
        (o.tonight ? "It leaves this evening: no night to cover." : "It leaves tomorrow, so there's a night in San Francisco to cover.")
      );
    },
  },

  queries: {
    // Sorted before capping, earliest landing first: a cap of an unsorted
    // list keeps an arbitrary few.
    filter(args, { props, cap }) {
      const rows = props.options
        .filter((o) => (args.nonstop ? !o.via : true))
        .filter((o) => (args.noExtraFare ? o.extraFare === 0 : true))
        .filter((o) => (args.tonight ? o.tonight : true))
        .filter((o) => (args.airline ? o.airline.toLowerCase().includes(args.airline.toLowerCase()) : true));
      return cap(rows, fmt);
    },
    earliest(_args, { props, cap }) {
      return cap(props.options.filter((o) => o.seatsLeft > 0).slice(0, 1), fmt);
    },
  },
});

export const seatMapServer = seatMap.implement({
  digest(p, { handle }) {
    const seats = p.rows.flatMap((r) => r.seats);
    const free = seats.filter((s) => !s.taken);
    const legroomRows = [...new Set(p.rows.filter((r) => r.seats.some((s) => s.extraLegroom)).map((r) => r.row))];
    return (
      `Seat map for ${p.airline} ${p.flight} on screen as ${handle}: ${free.length} of ${seats.length} seats free, ` +
      `${free.filter((s) => s.window).length} of them by a window and ${free.filter((s) => s.extraLegroom).length} ` +
      `with extra legroom (rows ${legroomRows.join(" and ")}). The traveller picks one.`
    );
  },

  actions: {
    pick(seatId, { props, conversationId }) {
      const seat = props.rows.flatMap((r) => r.seats).find((s) => s.id === seatId);
      if (!seat) throw new Error(`no seat ${seatId} on ${props.flight}`);
      // Other passengers are choosing too. A seat gone since this map was
      // drawn is refused, and the traveller picks again.
      if (seat.taken) throw new Error(`seat ${seatId} was taken a moment ago: pick another`);
      // Only a seat on the option the traveller chose can be booked: anything
      // else is refused, rather than taken and then not booked.
      if (!seatPicked(conversationId, props.optionId, seatId)) throw new Error(`${props.flight} isn't the flight you chose`);
      const kind = [seat.window ? "window" : "", seat.extraLegroom ? "extra legroom" : ""].filter(Boolean).join(", ");
      return `Picked seat ${seatId} on ${props.flight}${kind ? ` (${kind})` : ""}.`;
    },
  },
  queries: {},
});

export const careOptionsServer = careOptions.implement({
  digest(p, { handle }) {
    return (
      `Choices for ${p.night}, before ${p.flight}, on screen as ${handle}: ` +
      `${p.choices.map((c) => `${c.id}: ${c.title}, ${c.detail}`).join("; ")}. The traveller picks one.`
    );
  },

  actions: {
    choose(id, { props, conversationId }) {
      const choice = props.choices.find((c) => c.id === id);
      if (!choice) throw new Error(`no choice ${id}`);
      careChosen(conversationId, `${choice.title}: ${choice.detail}`);
      return `Chose ${choice.title}: ${choice.detail}.`;
    },
  },
  queries: {},
});

export const boardingPassServer = boardingPass.implement({
  digest(p, { handle }) {
    const legs = p.legs.map((l) => `${l.flight} ${l.from}→${l.to}`).join(", then ");
    return (
      `Boarding pass on screen as ${handle}: ${p.passenger}, booking ${p.reference}, ${legs}, leaving ${p.legs[0]?.depart}, ` +
      `landing ${p.arrive}. Seat ${p.seat}, gate ${p.gate}, boarding ${p.boards}.` +
      (p.care ? ` Tonight: ${p.care}.` : "")
    );
  },
  actions: {},
  queries: {},
});

export const surfaces = [tripCardServer, rebookingOptionsServer, seatMapServer, careOptionsServer, boardingPassServer];
