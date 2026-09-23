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
    const flights = FLIGHTS;
    return ctx.render(
      flightTableServer,
      { ...input, flights },
      { mode: "elicit" }, // compiles only because flight_table declares `select: resolve(...)`
    );
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

export const tools = [searchFlights, showSeatMap];
