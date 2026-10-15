/**
 * The guide's tools. `ctx.render` does the two channels: the props go to the
 * browser, the digest to the model, so no tool hand-writes that split.
 *
 * There is no query_ui here: HaiKIT derives it from the queries the surfaces
 * declare, so it always matches what's on screen.
 */

import { defineTool } from "@haikit/core";
import { z } from "zod";
import type { RebookOption } from "../shared/surfaces.ts";
import { chosen, optionsShown, passShown, seatsFor, seatsShown, stock, tripShown } from "./airline.ts";
import { CARE, OPTIONS, TRIP, bookingReference, optionById, seatRows } from "./data.ts";
import { boardingPassServer, careOptionsServer, rebookingOptionsServer, seatMapServer, tripCardServer } from "./surfaces.ts";

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
    const rows = seatsFor(ctx.conversationId, flight) ?? seatRows(flight);
    const props = { optionId, flight, airline: option.airline.split(" + ")[0]!, rows };
    const shown = await ctx.render(seatMapServer, props, { mode: "elicit" });
    if (shown.handle) seatsShown(ctx.conversationId, shown.handle, props);
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

export const issueBoardingPass = defineTool({
  name: "issue_boarding_pass",
  description:
    "Book the traveller onto what they chose and show the boarding pass. It books exactly what they clicked: the option, " +
    "the seat, and where they spend tonight. Display-only.",
  input: z.object({}),
  inputJsonSchema: none,

  async run(_input, ctx) {
    // The model can ask for a booking; only the traveller's clicks say what it is.
    const picked = chosen(ctx.conversationId);
    const option = picked?.option;
    if (!option) return ctx.text("The traveller hasn't chosen an option yet: show find_rebooking.");
    if (!picked.seat) return ctx.text(`The traveller hasn't picked a seat on ${option.flights[0]} yet: show show_seat_map.`);
    if (!option.tonight && !picked.care) return ctx.text("The traveller hasn't said where they'll spend tonight yet: show offer_care.");

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

export const tools = [findRebooking, showSeatMap, offerCare, issueBoardingPass];
