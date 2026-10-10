/**
 * Tools. Plain async functions — `ctx.render` does the dual channel, so a tool
 * author never hand-writes the split and therefore cannot get it wrong.
 *
 * Note there is no `query_ui` here. The framework derives it from the surfaces'
 * declared queries, so it always exists and can never drift from them.
 */

import { defineTool } from "@haikit/core";
import { z } from "zod";
import { FLIGHTS, seatRows } from "./data.ts";
import { flightTableServer, seatMapServer } from "./surfaces.ts";
import { watchFares } from "./airline.ts";

const FARE_SOURCES = 4;

const SearchInput = z.object({
  origin: z.string(),
  destination: z.string(),
  date: z.string(),
});

export const searchFlights = defineTool({
  name: "search_flights",
  description:
    "Search flights and render an interactive picker. This BLOCKS until the user selects a " +
    "flight in the UI — the component is the question, so do not also ask them to type a choice.",
  input: SearchInput,
  inputJsonSchema: {
    type: "object",
    properties: {
      origin: { type: "string", description: "IATA code, e.g. SFO" },
      destination: { type: "string", description: "IATA code, e.g. NRT" },
      date: { type: "string", description: "Departure date, e.g. 2026-03-14" },
    },
    required: ["origin", "destination", "date"],
    additionalProperties: false,
  },

  async run(input, ctx) {
    // Stands in for asking several fare sources in turn, so the tool row has
    // progress to show. The flights are the same seeded set either way; only
    // the wait is made up.
    ctx.progress({ message: "Checking fare sources", done: 0, total: FARE_SOURCES });
    for (let done = 1; done <= FARE_SOURCES; done++) {
      await new Promise((r) => setTimeout(r, 150));
      ctx.progress({ done });
    }

    const flights = FLIGHTS;
    const shown = await ctx.render(
      flightTableServer,
      { ...input, flights },
      { mode: "elicit" }, // compiles only because flight_table declares `select: resolve(...)`
    );
    // fares move while the user looks: the airline revises this table in place
    if (shown.handle) watchFares(ctx.conversationId, shown.handle, { ...input, flights });
    return shown;
  },
});

export const showSeatMap = defineTool({
  name: "show_seat_map",
  description: "Render a seat map for a chosen flight. Display-only — does not block.",
  input: z.object({ flightId: z.string() }),
  inputJsonSchema: {
    type: "object",
    properties: { flightId: { type: "string" } },
    required: ["flightId"],
    additionalProperties: false,
  },

  async run(input, ctx) {
    const flight = FLIGHTS.find((f) => f.id === input.flightId);
    if (!flight) return ctx.text(`Unknown flight ${input.flightId}.`);

    return ctx.render(seatMapServer, {
      flightId: flight.id,
      airline: flight.airline,
      rows: seatRows(flight.id),
    });
  },
});

// Revises a seat map already on screen, in place: the user keeps their place
// in it, and anything they picked stays picked.
export const highlightSeats = defineTool({
  name: "highlight_seats",
  description:
    "Pick out the free window or extra-legroom seats on a seat map already shown, in place, " +
    "rather than showing a new one.",
  input: z.object({ handle: z.string(), flightId: z.string(), kind: z.enum(["window", "legroom"]) }),
  inputJsonSchema: {
    type: "object",
    properties: {
      handle: { type: "string", description: "the seat map's handle, e.g. ui_02" },
      flightId: { type: "string" },
      kind: { type: "string", enum: ["window", "legroom"] },
    },
    required: ["handle", "flightId", "kind"],
    additionalProperties: false,
  },

  async run(input, ctx) {
    const flight = FLIGHTS.find((f) => f.id === input.flightId);
    if (!flight) return ctx.text(`Unknown flight ${input.flightId}.`);
    return ctx.update(seatMapServer, input.handle, {
      flightId: flight.id,
      airline: flight.airline,
      rows: seatRows(flight.id),
      highlight: input.kind,
    });
  },
});

export const tools = [searchFlights, showSeatMap, highlightSeats];
