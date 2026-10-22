/**
 * The guide's tools. `ctx.render` does the two channels: the props go to the
 * browser, the digest to the model, so no tool hand-writes that split.
 *
 * There is no query_ui here: HaiKIT derives it from the queries the surfaces
 * declare, so it always matches what's on screen.
 */

import { defineTool } from "@haikit/core";
import { z } from "zod";
import { Day, TokyoAirport, type HomeFlight, type RebookOption } from "../shared/surfaces.ts";
import {
  booking,
  chosen,
  daysHome,
  bookingsNow,
  homeTicket,
  issuedPass,
  landsInTimeForHome,
  leavesAfterLanding,
  optionsShown,
  outboundLands,
  passShown,
  passShownAgain,
  priced,
  reviewShown,
  seatKey,
  seatsFor,
  seatsShown,
  stock,
  ticketShown,
  tripShown,
  tripShownAgain,
} from "./airline.ts";
import {
  CARE,
  AIRPORT_NAMES,
  DAY_NAMES,
  HOME,
  OPTIONS,
  PAYMENT,
  TAXES,
  TRIP,
  bagsFor,
  bookingReference,
  faresFor,
  flightsHome,
  homeFlight,
  optionById,
  seatRows,
  usd,
} from "./data.ts";
import {
  boardingPassServer,
  bookingConfirmedServer,
  bookingReviewServer,
  careOptionsServer,
  fareOptionsServer,
  flightResultsServer,
  flightSearchServer,
  rebookingOptionsServer,
  rebookingReviewServer,
  seatMapServer,
  tripCardServer,
} from "./surfaces.ts";

const none = { type: "object", properties: {}, additionalProperties: false } as const;
const optionInput = {
  type: "object",
  properties: { optionId: { type: "string", description: "an option's id from the rebooking options, such as o05" } },
  required: ["optionId"],
  additionalProperties: false,
} as const;

// Passed to createHai as `init`: it runs when the conversation starts, and
// the model doesn't. Nothing happens until the airline does something.
export const showTrip = defineTool({
  name: "show_trip",
  description: "Show the traveller's booking. Display-only.",
  input: z.object({}),
  inputJsonSchema: none,

  async run(_input, ctx) {
    const shown = await ctx.render(tripCardServer, TRIP);
    if (shown.handle) tripShown(ctx.conversationId, shown.handle);
    return shown;
  },
});

// show_trip is the init tool, so it runs once: HaiKIT refuses it after that.
// This shows the cards again instead, and books nothing.
export const showBookings = defineTool({
  name: "show_bookings",
  description:
    "Show the traveller's bookings again, as they are now: the trip card, the boarding pass for the new flight to Tokyo " +
    "once it's issued, and the e-ticket for the flight home once it's issued. Display-only: it books nothing. Use it when " +
    "they ask to see their trip, their bookings, or a card again.",
  input: z.object({}),
  inputJsonSchema: none,

  async run(_input, ctx) {
    const now = await bookingsNow(ctx.conversationId);
    if (!now) return ctx.text("This conversation hasn't shown its trip yet.");
    const trip = await ctx.render(tripCardServer, now.trip);
    if (trip.handle) tripShownAgain(ctx.conversationId, trip.handle);
    const shown = [trip.model];
    if (now.pass) {
      const pass = await ctx.render(boardingPassServer, now.pass);
      if (pass.handle) passShownAgain(ctx.conversationId, pass.handle, now.pass);
      shown.push(pass.model);
    }
    if (now.ticket) shown.push((await ctx.render(bookingConfirmedServer, now.ticket)).model);
    if (!now.pass && !now.ticket) shown.push("Nothing else is booked yet.");
    return ctx.text(shown.join("\n"));
  },
});

const Filters = z.object({
  nonstop: z.boolean().optional(),
  noExtraFare: z.boolean().optional(),
  tonight: z.boolean().optional(),
});

export const findRebooking = defineTool({
  name: "find_rebooking",
  description:
    "Show every way to Tokyo in place of the cancelled flight, as a picker. BLOCKS until the traveller picks one: " +
    "the picker is the question, so don't also ask them to type a choice. Pass filters to show only some of the options.",
  input: Filters,
  inputJsonSchema: {
    type: "object",
    properties: {
      nonstop: { type: "boolean", description: "only nonstops" },
      noExtraFare: { type: "boolean", description: "only options at no extra cost" },
      tonight: { type: "boolean", description: "only options leaving this evening" },
    },
    additionalProperties: false,
  },

  async run(filters, ctx) {
    // What the airline has now: after the holds run out, fewer seats and no hold.
    const { held, options: all } = stock(ctx.conversationId);
    const keep = (o: RebookOption) =>
      (!filters.nonstop || !o.via) && (!filters.noExtraFare || o.extraFare === 0) && (!filters.tonight || o.tonight);
    const options = all.filter(keep);
    const filter =
      [filters.nonstop && "nonstops", filters.noExtraFare && "at no extra cost", filters.tonight && "leaving tonight"]
        .filter(Boolean)
        .join(", ") || null;
    if (!options.length) return ctx.text(`No options are ${filter}. All ${OPTIONS.length} are still there without the filter.`);

    const props = { cancelled: TRIP.flight, options, total: OPTIONS.length, filter, held };
    const shown = await ctx.render(rebookingOptionsServer, props, { mode: "elicit" });
    if (shown.handle) optionsShown(ctx.conversationId, shown.handle, props);
    return shown;
  },
});

export const showSeatMap = defineTool({
  name: "show_seat_map",
  description:
    "Show the seat map for the first flight of the option the traveller chose. BLOCKS until they pick a seat.",
  input: z.object({ optionId: z.string() }),
  inputJsonSchema: optionInput,

  async run({ optionId }, ctx) {
    const option = optionById(optionId);
    if (!option) return ctx.text(`No option ${optionId}.`);
    // A seat can only be booked on the option the traveller clicked.
    const picked = chosen(ctx.conversationId)?.option;
    if (!picked) return ctx.text("The traveller hasn't chosen an option yet: show find_rebooking.");
    if (picked.id !== optionId) return ctx.text(`The traveller chose ${picked.id} (${picked.flights.join(" + ")}), not ${optionId}: show that one's seat map.`);
    const flight = option.flights[0]!;
    // Shown again, a map keeps the seats other passengers have taken since.
    const key = seatKey(option.depart, flight);
    const rows = seatsFor(ctx.conversationId, key) ?? seatRows(flight);
    const props = { purpose: "rebook" as const, optionId, flight, airline: option.airline.split(" + ")[0]!, rows };
    const shown = await ctx.render(seatMapServer, props, { mode: "elicit" });
    if (shown.handle) seatsShown(ctx.conversationId, shown.handle, props, key);
    return shown;
  },
});

export const offerCare = defineTool({
  name: "offer_care",
  description:
    "When the new flight leaves tomorrow, ask where the traveller will spend tonight: a hotel, the lounge, or their own " +
    "arrangements. BLOCKS until they choose.",
  input: z.object({ optionId: z.string() }),
  inputJsonSchema: optionInput,

  async run({ optionId }, ctx) {
    const option = optionById(optionId);
    if (!option) return ctx.text(`No option ${optionId}.`);
    if (option.tonight) return ctx.text(`${option.flights[0]} leaves this evening: there's no night to cover.`);
    return ctx.render(
      careOptionsServer,
      { night: "Tuesday night in San Francisco", flight: option.flights.join(" + "), choices: CARE },
      { mode: "elicit" },
    );
  },
});

export const reviewRebooking = defineTool({
  name: "review_rebooking",
  description:
    "When the option the traveller chose costs extra, show the change for them to check before it's booked: the new " +
    "flight, the seat, tonight, and the extra fare. Nothing is booked until they confirm. BLOCKS until they confirm or ask " +
    "for a different flight or seat. An option at no extra cost needs no review: call issue_boarding_pass.",
  input: z.object({}),
  inputJsonSchema: none,

  async run(_input, ctx) {
    const picked = chosen(ctx.conversationId);
    const option = picked?.option;
    if (!option) return ctx.text("The traveller hasn't chosen an option yet: show find_rebooking.");
    if (!picked.seat) return ctx.text(`The traveller hasn't picked a seat on ${option.flights[0]} yet: show show_seat_map.`);
    if (!option.tonight && !picked.care) return ctx.text("The traveller hasn't said where they'll spend tonight yet: show offer_care.");
    if (option.extraFare === 0) return ctx.text(`${option.flights.join(" + ")} costs nothing extra, so there's nothing to confirm: call issue_boarding_pass.`);
    const props = {
      passenger: TRIP.passenger,
      cancelled: TRIP.flight,
      optionId: option.id,
      flight: option.flights.join(" + "),
      airline: option.airline,
      legs: option.flights.map((flight, i) => ({
        flight,
        from: i === 0 ? TRIP.from.code : option.via!,
        to: i === option.flights.length - 1 ? option.to : option.via!,
      })),
      depart: option.depart,
      arrive: option.arrive,
      seat: picked.seat,
      care: option.tonight ? null : picked.care,
      extraFare: option.extraFare,
      payment: PAYMENT,
    };
    return ctx.render(rebookingReviewServer, props, { mode: "elicit" });
  },
});

export const issueBoardingPass = defineTool({
  name: "issue_boarding_pass",
  description:
    "Book the traveller onto what they chose and show the boarding pass. It books exactly what they clicked: the option, " +
    "the seat, where they spend tonight, and for an option that costs extra, the amount they confirmed. Display-only.",
  input: z.object({}),
  inputJsonSchema: none,

  async run(_input, ctx) {
    // The model can ask for a booking; only the traveller's clicks say what it is.
    const picked = chosen(ctx.conversationId);
    const option = picked?.option;
    if (!option) return ctx.text("The traveller hasn't chosen an option yet: show find_rebooking.");
    if (!picked.seat) return ctx.text(`The traveller hasn't picked a seat on ${option.flights[0]} yet: show show_seat_map.`);
    if (!option.tonight && !picked.care) return ctx.text("The traveller hasn't said where they'll spend tonight yet: show offer_care.");
    // Booked already, with nothing changed since: issuing it again would book it again, under a new reference.
    const issued = issuedPass(ctx.conversationId);
    if (issued && issued.flight === option.flights.join(" + ") && issued.seat === picked.seat) {
      return ctx.text(`${issued.flight}, seat ${issued.seat}, is already booked, as ${issued.reference}: nothing was booked again. To show the boarding pass again, call show_bookings.`);
    }
    // An option that costs extra is booked only once the traveller has confirmed that amount.
    if (option.extraFare > 0 && picked.confirmed !== option.extraFare) {
      return ctx.text(`${option.flights.join(" + ")} costs ${usd(option.extraFare)} extra, and the traveller hasn't confirmed it yet: show review_rebooking.`);
    }
    // Checked again here: a flight home may have been ticketed since the option was chosen.
    const home = homeTicket(ctx.conversationId);
    if (home && !landsInTimeForHome(ctx.conversationId, option.arrive)) {
      return ctx.text(`${option.flights.join(" + ")} lands ${option.arrive}, too late for the flight home, ${home.flight} at ${home.depart}: nothing was booked. Show find_rebooking for another.`);
    }

    const [hh, mm] = option.depart.slice(4).split(":").map(Number) as [number, number];
    const boarding = hh * 60 + mm - 40;
    const props = {
      passenger: TRIP.passenger,
      reference: bookingReference(),
      flight: option.flights.join(" + "),
      airline: option.airline,
      legs: option.flights.map((flight, i) => ({
        flight,
        from: i === 0 ? TRIP.from.code : option.via!,
        to: i === option.flights.length - 1 ? option.to : option.via!,
        depart: i === 0 ? option.depart : `connects at ${option.via}`,
      })),
      arrive: option.arrive,
      seat: picked.seat,
      gate: `G${90 + (Number(option.id.slice(1)) % 10)}`,
      boards: `${String(Math.floor(boarding / 60)).padStart(2, "0")}:${String(boarding % 60).padStart(2, "0")}`,
      care: option.tonight ? null : picked.care,
    };
    const shown = await ctx.render(boardingPassServer, props);
    if (shown.handle) passShown(ctx.conversationId, shown.handle, props);
    return shown;
  },
});

// ───────────────────────────────────────────── booking the flight home

/**
 * Once the flight home is ticketed, no step of booking it runs again: a
 * second Confirm could only be refused. Null while it isn't.
 */
const ticketed = (conversationId: string) => {
  const done = booking(conversationId)?.ticket;
  return done ? `The flight home is already booked: ${done.legs.map((l) => l.flight).join(" + ")}, booking ${done.reference}.` : null;
};

/** Each leg of a flight home, from its Tokyo airport to San Francisco. */
const legsOf = (f: HomeFlight) =>
  f.flights.map((flight, i) => ({ flight, from: i === 0 ? f.from : f.via!, to: i === f.flights.length - 1 ? HOME.code : f.via! }));

export const startBooking = defineTool({
  name: "start_booking",
  description:
    "Book the traveller's flight home, Tokyo to San Francisco. Shows the search, filled in from their trip: the traveller " +
    "and the airports. Pass the day if they named one, and a Tokyo airport if they asked for one; otherwise they choose " +
    "on the search. BLOCKS until they search.",
  input: z.object({ date: Day.optional(), from: TokyoAirport.optional() }),
  inputJsonSchema: {
    type: "object",
    properties: {
      date: { type: "string", enum: Day.options, description: "the day to fly home, if the traveller named one" },
      from: { type: "string", enum: TokyoAirport.options, description: "NRT or HND if they asked for one; TYO, either, by default" },
    },
    additionalProperties: false,
  },

  async run({ date, from }, ctx) {
    const done = ticketed(ctx.conversationId);
    if (done) return ctx.text(done);
    // the days with a flight home after the traveller lands, nights counted from then
    const days = daysHome(ctx.conversationId);
    if (!days.length) return ctx.text(`No flight home leaves long enough after the traveller lands in Tokyo (${outboundLands(ctx.conversationId)}).`);
    // a day asked for that no flight works on isn't filled in: the traveller chooses
    const day = date && days.some((d) => d.id === date) ? date : null;
    return ctx.render(
      flightSearchServer,
      {
        passenger: TRIP.passenger,
        from: from ?? "TYO",
        to: HOME,
        date: day,
        days,
        sources: { passenger: "your trip", from: from ? "your message" : "your trip", to: "your trip", date: day ? "your message" : null },
      },
      { mode: "elicit" },
    );
  },
});

export const showFlights = defineTool({
  name: "show_flights",
  description:
    "Show the flights home for the search the traveller made, as a picker. BLOCKS until they pick one: don't also ask " +
    "them to type a choice. Pass filters to show only some of the flights.",
  input: z.object({ nonstop: z.boolean().optional(), airport: z.enum(["NRT", "HND"]).optional() }),
  inputJsonSchema: {
    type: "object",
    properties: {
      nonstop: { type: "boolean", description: "only nonstops" },
      airport: { type: "string", enum: ["NRT", "HND"], description: "only flights from Narita or Haneda" },
    },
    additionalProperties: false,
  },

  async run(filters, ctx) {
    const done = ticketed(ctx.conversationId);
    if (done) return ctx.text(done);
    // The flights are for the search the traveller made, not one the model makes up.
    const search = booking(ctx.conversationId)?.search;
    if (!search) return ctx.text("The traveller hasn't searched yet: show start_booking.");
    // each at its Basic fare as the airline has it now, raises included, and
    // only those that leave after the traveller has landed in Tokyo
    const day = flightsHome(search.date)
      .filter((f) => search.from === "TYO" || f.from === search.from)
      .filter((f) => leavesAfterLanding(ctx.conversationId, f))
      .map((f) => ({ ...f, price: priced(ctx.conversationId, f, faresFor(f)[0]!).price }));
    if (!day.length) {
      return ctx.text(
        `No flights home on ${DAY_NAMES[search.date]} (${search.date}) from ${AIRPORT_NAMES[search.from]} (${search.from}) leave long enough ` +
          `after the traveller lands in Tokyo (${outboundLands(ctx.conversationId)}): show start_booking, with that airport, for a later day.`,
      );
    }
    const flights = day.filter((f) => (!filters.nonstop || !f.via) && (!filters.airport || f.from === filters.airport));
    const filter = [filters.nonstop && "nonstops", filters.airport && `from ${filters.airport}`].filter(Boolean).join(", ") || null;
    if (!flights.length) return ctx.text(`No flights home on ${DAY_NAMES[search.date]} are ${filter}. All ${day.length} are still there without the filter.`);
    return ctx.render(flightResultsServer, { flights, date: search.date, from: search.from, total: day.length, filter }, { mode: "elicit" });
  },
});

const flightInput = {
  type: "object",
  properties: { flightId: { type: "string", description: "the flight home's id from the flights shown, such as r01" } },
  required: ["flightId"],
  additionalProperties: false,
} as const;

export const showFares = defineTool({
  name: "show_fares",
  description: "Show the fares on the flight home the traveller chose: Basic, Standard and Flex. BLOCKS until they pick one.",
  input: z.object({ flightId: z.string() }),
  inputJsonSchema: flightInput,

  async run({ flightId }, ctx) {
    const done = ticketed(ctx.conversationId);
    if (done) return ctx.text(done);
    const b = booking(ctx.conversationId);
    const chosen = b?.flight;
    if (!chosen || !b.search) return ctx.text("The traveller hasn't chosen a flight home yet: show show_flights.");
    if (chosen.id !== flightId) return ctx.text(`The traveller chose ${chosen.id} (${chosen.flights.join(" + ")}), not ${flightId}: show that one's fares.`);
    // The fares start from the flight's own price, not the one the picker
    // showed, which already has the Basic raises in it: priced() adds each
    // fare's raises once.
    const flight = homeFlight(b.search.date, flightId) ?? chosen;
    const fares = faresFor(flight).map((f) => priced(ctx.conversationId, flight, f));
    return ctx.render(
      fareOptionsServer,
      { flightId, flight: flight.flights.join(" + "), airline: flight.airline, date: b.search.date, fares },
      { mode: "elicit" },
    );
  },
});

export const showHomeSeats = defineTool({
  name: "show_home_seats",
  description:
    "Show the seat map for the flight home, when the fare the traveller chose lets them choose a seat (Standard or Flex). " +
    "BLOCKS until they pick a seat.",
  input: z.object({ flightId: z.string() }),
  inputJsonSchema: flightInput,

  async run({ flightId }, ctx) {
    const done = ticketed(ctx.conversationId);
    if (done) return ctx.text(done);
    const b = booking(ctx.conversationId);
    if (!b?.flight) return ctx.text("The traveller hasn't chosen a flight home yet: show show_flights.");
    if (b.flight.id !== flightId) return ctx.text(`The traveller chose ${b.flight.id} (${b.flight.flights.join(" + ")}), not ${flightId}.`);
    if (!b.fare) return ctx.text(`The traveller hasn't chosen a fare yet: show show_fares for ${flightId}.`);
    if (!b.fare.seatChoice) return ctx.text(`The ${b.fare.name} fare assigns the seat at check-in: show review_booking.`);
    const flight = b.flight.flights[0]!;
    const key = seatKey(b.flight.depart, flight);
    const rows = seatsFor(ctx.conversationId, key) ?? seatRows(flight);
    const props = { purpose: "book" as const, optionId: flightId, flight, airline: b.flight.airline.split(" + ")[0]!, rows };
    const shown = await ctx.render(seatMapServer, props, { mode: "elicit" });
    if (shown.handle) seatsShown(ctx.conversationId, shown.handle, props, key);
    return shown;
  },
});

export const reviewBooking = defineTool({
  name: "review_booking",
  description:
    "Show the booking of the flight home for the traveller to check: flight, fare, seat and total. Nothing is booked until " +
    "they confirm. BLOCKS until they confirm or ask to change the flight, fare or seat.",
  input: z.object({}),
  inputJsonSchema: none,

  async run(_input, ctx) {
    const done = ticketed(ctx.conversationId);
    if (done) return ctx.text(done);
    const b = booking(ctx.conversationId);
    if (!b?.flight) return ctx.text("The traveller hasn't chosen a flight home yet: show show_flights.");
    if (!b.fare) return ctx.text(`The traveller hasn't chosen a fare yet: show show_fares for ${b.flight.id}.`);
    if (b.fare.seatChoice && !b.seat) return ctx.text(`The traveller hasn't picked a seat yet: show show_home_seats for ${b.flight.id}.`);
    const props = {
      passenger: TRIP.passenger,
      flightId: b.flight.id,
      airline: b.flight.airline,
      legs: legsOf(b.flight),
      depart: b.flight.depart,
      arrive: b.flight.arrive,
      fare: { id: b.fare.id, name: b.fare.name, seatChoice: b.fare.seatChoice },
      seat: b.fare.seatChoice ? b.seat : null,
      price: { fare: b.fare.price, taxes: TAXES, total: b.fare.price + TAXES },
      previousTotal: null,
      payment: PAYMENT,
    };
    const shown = await ctx.render(bookingReviewServer, props, { mode: "elicit" });
    if (shown.handle) reviewShown(ctx.conversationId, shown.handle, props);
    return shown;
  },
});

export const issueTicket = defineTool({
  name: "issue_ticket",
  description:
    "Book the flight home the traveller confirmed and show the e-ticket. It books exactly what they confirmed: the flight, " +
    "fare, seat and total. Display-only.",
  input: z.object({}),
  inputJsonSchema: none,

  async run(_input, ctx) {
    // The model can ask for the ticket; only the traveller's Confirm says what it's for.
    const done = ticketed(ctx.conversationId);
    if (done) return ctx.text(done);
    const b = booking(ctx.conversationId);
    if (!b?.flight || !b.fare || b.confirmed === null) return ctx.text("The traveller hasn't confirmed a booking yet: show review_booking.");
    // Checked again here: the flight to Tokyo may have changed since the flights were shown.
    if (!leavesAfterLanding(ctx.conversationId, b.flight)) {
      return ctx.text(
        `${b.flight.flights.join(" + ")} leaves ${b.flight.depart}, too soon after the traveller lands in Tokyo (${outboundLands(ctx.conversationId)}): ` +
          "nothing was booked. Show show_flights for another.",
      );
    }
    const props = {
      passenger: TRIP.passenger,
      reference: bookingReference(),
      legs: legsOf(b.flight),
      depart: b.flight.depart,
      arrive: b.flight.arrive,
      fare: b.fare.name,
      seat: b.fare.seatChoice ? b.seat : null,
      bags: bagsFor(b.fare.id),
      total: b.confirmed,
    };
    const shown = await ctx.render(bookingConfirmedServer, props);
    if (shown.handle) ticketShown(ctx.conversationId, shown.handle, props);
    return shown;
  },
});

export const tools = [
  showBookings,
  findRebooking,
  showSeatMap,
  offerCare,
  reviewRebooking,
  issueBoardingPass,
  startBooking,
  showFlights,
  showFares,
  showHomeSeats,
  reviewBooking,
  issueTicket,
];
