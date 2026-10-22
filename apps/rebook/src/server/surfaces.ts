/**
 * The server halves of the surfaces: what the model is told about each, and
 * what a click on it means. This file never reaches the browser.
 */

import type { HomeFlight, RebookOption } from "../shared/surfaces.ts";
import {
  boardingPass,
  bookingConfirmed,
  bookingReview,
  careOptions,
  fareOptions,
  flightResults,
  flightSearch,
  rebookingOptions,
  rebookingReview,
  seatMap,
  tripCard,
} from "../shared/surfaces.ts";
import {
  booking,
  bookingConfirmedAt,
  careChosen,
  extraConfirmed,
  fareChosen,
  homeFlightChosen,
  homeSeatPicked,
  homeTicket,
  landsInTimeForHome,
  leavesAfterLanding,
  optionChosen,
  searched,
  seatPicked,
} from "./airline.ts";
import { AIRPORT_NAMES, DAY_NAMES, duration, later, usd } from "./data.ts";

/** One option, as the model reads it: everything it needs to talk about it. */
export const fmt = (o: RebookOption) =>
  `${o.flights.join(" + ")} (${o.airline}) ${o.via ? `via ${o.via}` : "nonstop"}, leaves ${o.depart}, ` +
  `lands ${o.to} ${o.arrive} (${later(o.laterMin)} later), ` +
  `${o.extraFare ? `$${o.extraFare} extra` : "no extra cost"}, ${o.seatsLeft ? `${o.seatsLeft} seats left` : "sold out"} [${o.id}]`;

/** One flight home, as the model reads it. */
export const fmtHome = (f: HomeFlight) =>
  `${f.flights.join(" + ")} (${f.airline}) ${f.via ? `via ${f.via}` : "nonstop"}, leaves ${f.from} ${f.depart}, ` +
  `lands SFO ${f.arrive} (${duration(f.durationMin)}), from ${usd(f.price)}, ${f.seatsLeft} seat${f.seatsLeft === 1 ? "" : "s"} left [${f.id}]`;

export const tripCardServer = tripCard.implement({
  digest(p, { handle }) {
    const trip = `${p.passenger}, booking ${p.reference}: ${p.airline} ${p.flight}, ${p.from.city} ${p.depart} to ${p.to.city} ${p.arrive}, seat ${p.seat}`;
    const status = p.status === "cancelled" ? ` CANCELLED, because of ${p.reason}.` : " On time.";
    const home = p.home
      ? ` Flight home booked: ${p.home.flight}, leaving ${p.home.depart}, booking ${p.home.reference}.`
      : " No flight home yet: a Book my flight home button on the card starts booking one.";
    return `Trip on screen as ${handle}: ${trip}.${status}${home}`;
  },
  actions: {
    // An inform: it tells the guide, and the guide starts the booking.
    book_home(_value, { props }) {
      if (props.home) throw new Error(`the flight home is already booked: ${props.home.flight}, booking ${props.home.reference}`);
      return "The traveller clicked Book my flight home.";
    },
  },
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
      // with the flight home already ticketed, the new flight must land in time for it
      const home = homeTicket(conversationId);
      if (home && !landsInTimeForHome(conversationId, o.arrive)) {
        throw new Error(`${o.flights.join(" + ")} lands ${o.arrive}, too late for your flight home at ${home.depart}: pick another`);
      }
      optionChosen(conversationId, o);
      return (
        `The traveller chose ${o.id}: ${fmt(o)}. ` +
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
      `Seat map for ${p.airline} ${p.flight}${p.purpose === "book" ? ", for the flight home," : ""} on screen as ${handle}: ${free.length} of ${seats.length} seats free, ` +
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
      // Only a seat on the flight the traveller chose can be booked: anything
      // else is refused, rather than taken and then not booked.
      const home = props.purpose === "book";
      const recorded = home ? homeSeatPicked(conversationId, props.optionId, seatId) : seatPicked(conversationId, props.optionId, seatId);
      if (!recorded) throw new Error(`${props.flight} isn't the flight you chose`);
      const kind = [seat.window ? "window" : "", seat.extraLegroom ? "extra legroom" : ""].filter(Boolean).join(", ");
      return `The traveller picked seat ${seatId} on ${props.flight}${kind ? ` (${kind})` : ""}${home ? ", for the flight home" : ""}.`;
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
      return `The traveller chose ${choice.title}: ${choice.detail}.`;
    },
  },
  queries: {},
});

export const rebookingReviewServer = rebookingReview.implement({
  digest(p, { handle }) {
    const legs = p.legs.map((l) => `${l.flight} ${l.from}→${l.to}`).join(", then ");
    return (
      `Review of the change from ${p.cancelled} on screen as ${handle}: ${legs}, leaving ${p.depart}, landing ${p.arrive}. ` +
      `Seat ${p.seat}${p.care ? `. Tonight: ${p.care}` : ""}. ${usd(p.extraFare)} extra on top of the ticket the traveller has, ` +
      `paid with the card on file; nothing is charged in this demo. ` +
      "Nothing is booked until the traveller confirms, or asks for a different flight or seat."
    );
  },
  actions: {
    // The click carries the extra fare the traveller saw: they pay exactly that.
    confirm({ extraFare }, { props, conversationId }) {
      if (extraFare !== props.extraFare) throw new Error(`the extra fare is ${usd(props.extraFare)}, not ${usd(extraFare)}: check it and confirm again`);
      if (!extraConfirmed(conversationId, props.optionId, extraFare)) throw new Error(`${props.flight} isn't the flight you chose`);
      return `The traveller confirmed the change to ${props.flight}, at ${usd(extraFare)} extra.`;
    },
    change(what, { props }) {
      return what === "flight"
        ? `The traveller wants a different flight instead of ${props.cancelled}.`
        : `The traveller wants a different seat on ${props.legs[0]?.flight ?? props.flight}.`;
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

// ───────────────────────────────────────────── booking the flight home

export const flightSearchServer = flightSearch.implement({
  digest(p, { handle }) {
    return (
      `Search for flights home on screen as ${handle}: ${p.passenger}, ${AIRPORT_NAMES[p.from]} (${p.from}) to ${p.to.city} (${p.to.code}), ` +
      (p.date ? `on ${DAY_NAMES[p.date]} (${p.date}). ` : "no day chosen yet: the traveller picks one. ") +
      `Filled in from the trip: the traveller and the airports${p.date ? `; the day from ${p.sources.date}` : ""}. ` +
      `The traveller can change the day and the Tokyo airport, then searches.`
    );
  },
  actions: {
    search(value, { conversationId }) {
      searched(conversationId, value);
      return `The traveller searched flights home: ${AIRPORT_NAMES[value.from]} to SFO on ${DAY_NAMES[value.date]} (${value.date}).`;
    },
  },
  queries: {},
});

export const flightResultsServer = flightResults.implement({
  // Like the rebooking options: what the next sentence needs, the rest by query.
  digest(p, { handle }) {
    const cheapest = [...p.flights].sort((a, b) => a.price - b.price)[0];
    const fastest = [...p.flights].sort((a, b) => a.durationMin - b.durationMin)[0];
    const count = (keep: (f: HomeFlight) => boolean) => p.flights.filter(keep).length;
    return [
      `Flights home on ${DAY_NAMES[p.date]}, on screen as ${handle}: ${p.flights.length} flights, ${AIRPORT_NAMES[p.from]} to SFO` +
        (p.filter ? ` (${p.filter}, of ${p.total}).` : "."),
      cheapest ? `Cheapest: ${fmtHome(cheapest)}.` : "",
      fastest && fastest !== cheapest ? `Fastest: ${fmtHome(fastest)}.` : "",
      `Nonstop: ${count((f) => !f.via)}. From Narita: ${count((f) => f.from === "NRT")}. From Haneda: ${count((f) => f.from === "HND")}.`,
      "Prices are the Basic fare before taxes; the other fares show once a flight is chosen. The traveller picks one; query_ui filter and cheapest answer about the rest.",
    ]
      .filter(Boolean)
      .join(" ");
  },
  actions: {
    choose(flightId, { props, conversationId }) {
      const f = props.flights.find((x) => x.id === flightId);
      if (!f) throw new Error(`no flight ${flightId}`);
      // the flight to Tokyo may have changed since these were shown
      if (!leavesAfterLanding(conversationId, f)) throw new Error(`${f.flights.join(" + ")} leaves before you'd be through the airport in Tokyo: pick a later one`);
      homeFlightChosen(conversationId, f);
      return `The traveller chose flight ${f.id}: ${fmtHome(f)}.`;
    },
  },
  queries: {
    filter(args, { props, cap }) {
      const rows = props.flights
        .filter((f) => (args.nonstop ? !f.via : true))
        .filter((f) => (args.airport ? f.from === args.airport : true))
        .filter((f) => (args.maxPrice !== undefined ? f.price <= args.maxPrice : true))
        .filter((f) => (args.airline ? f.airline.toLowerCase().includes(args.airline.toLowerCase()) : true));
      return cap(rows, fmtHome);
    },
    cheapest(_args, { props, cap }) {
      return cap([...props.flights].sort((a, b) => a.price - b.price).slice(0, 1), fmtHome);
    },
  },
});

export const fareOptionsServer = fareOptions.implement({
  digest(p, { handle }) {
    const fares = p.fares
      .map((f) => `${f.name} ${usd(f.price)} (${f.includes.filter((i) => i.yes).map((i) => i.text.toLowerCase()).join(", ")}${f.seatChoice ? "" : "; seat assigned at check-in"})`)
      .join("; ");
    return `Fares for ${p.airline} ${p.flight} on ${DAY_NAMES[p.date]}, on screen as ${handle}: ${fares}. Before taxes. The traveller picks one.`;
  },
  actions: {
    choose(fareId, { props, conversationId }) {
      const fare = props.fares.find((f) => f.id === fareId);
      if (!fare) throw new Error(`no fare ${fareId}`);
      if (booking(conversationId)?.flight?.id !== props.flightId) throw new Error(`${props.flight} isn't the flight you chose`);
      fareChosen(conversationId, fare);
      return (
        `The traveller chose the ${fare.name} fare, ${usd(fare.price)}, on ${props.flight} [${props.flightId}]: ` +
        (fare.seatChoice ? "the traveller chooses a seat." : "the seat is assigned at check-in, so there's no seat to choose.")
      );
    },
  },
  queries: {},
});

export const bookingReviewServer = bookingReview.implement({
  digest(p, { handle }) {
    const legs = p.legs.map((l) => `${l.flight} ${l.from}→${l.to}`).join(", then ");
    return (
      `Review of the booking on screen as ${handle}: ${p.passenger}, ${legs}, leaving ${p.depart}, landing SFO ${p.arrive}. ` +
      `${p.fare.name} fare, seat ${p.seat ?? "assigned at check-in"}. Total ${usd(p.price.total)} (${usd(p.price.fare)} fare and ${usd(p.price.taxes)} taxes), ` +
      `paid with the card on file; nothing is charged in this demo.` +
      (p.previousTotal !== null ? ` The airline raised the fare while it was on screen: it was ${usd(p.previousTotal)}.` : "") +
      ` Nothing is booked until the traveller confirms, or asks to change the flight, fare${p.fare.seatChoice ? " or seat" : ""}.`
    );
  },
  actions: {
    // The click carries the total the traveller saw. One that isn't the total
    // now, because the airline has just raised it, is refused, not charged.
    confirm({ total }, { props, conversationId }) {
      if (total !== props.price.total) throw new Error(`the total is ${usd(props.price.total)} now, not ${usd(total)}: check it and confirm again`);
      bookingConfirmedAt(conversationId, total);
      return `The traveller confirmed the booking at ${usd(total)}.`;
    },
    change(what, { props }) {
      if (what === "seat" && !props.fare.seatChoice) throw new Error(`the ${props.fare.name} fare assigns the seat at check-in`);
      return `The traveller asked to change the ${what}.`;
    },
  },
  queries: {},
});

export const bookingConfirmedServer = bookingConfirmed.implement({
  digest(p, { handle }) {
    const legs = p.legs.map((l) => `${l.flight} ${l.from}→${l.to}`).join(", then ");
    return (
      `E-ticket on screen as ${handle}: ${p.passenger}, booking ${p.reference}, ${legs}, leaving ${p.depart}, landing SFO ${p.arrive}. ` +
      `${p.fare} fare, seat ${p.seat ?? "assigned at check-in"}, ${p.bags}. Paid ${usd(p.total)}.`
    );
  },
  actions: {},
  queries: {},
});

export const surfaces = [
  tripCardServer,
  rebookingOptionsServer,
  seatMapServer,
  careOptionsServer,
  rebookingReviewServer,
  boardingPassServer,
  flightSearchServer,
  flightResultsServer,
  fareOptionsServer,
  bookingReviewServer,
  bookingConfirmedServer,
];
