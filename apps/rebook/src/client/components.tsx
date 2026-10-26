/**
 * The browser halves of Rebook's surfaces and notices: a React component for
 * each, registered under its name.
 *
 * Typed against ../shared/, the same contracts the server implements: change
 * a prop or an action there and this side stops compiling.
 *
 * React writes text with textContent, never as HTML. Tool payloads are
 * untrusted input, even when the tool is your own. A click reaches the server
 * only through an action the contract declares; filtering and the rest stay
 * here.
 */

import { reactNotice, reactSurface } from "@haikit/react";
import { FlightCancelled, SeatConfirmed, TicketIssued } from "./notices.tsx";
import { BoardingPass } from "./surfaces/BoardingPass.tsx";
import { BookingConfirmed } from "./surfaces/BookingConfirmed.tsx";
import { BookingReview } from "./surfaces/BookingReview.tsx";
import { CareOptions } from "./surfaces/CareOptions.tsx";
import { FareOptions } from "./surfaces/FareOptions.tsx";
import { FlightResults } from "./surfaces/FlightResults.tsx";
import { FlightSearch } from "./surfaces/FlightSearch.tsx";
import { RebookingOptions } from "./surfaces/RebookingOptions.tsx";
import { RebookingReview } from "./surfaces/RebookingReview.tsx";
import { SeatMap } from "./surfaces/SeatMap.tsx";
import { TripCard } from "./surfaces/TripCard.tsx";

export const registry = {
  trip_card: reactSurface(TripCard),
  rebooking_options: reactSurface(RebookingOptions),
  seat_map: reactSurface(SeatMap),
  care_options: reactSurface(CareOptions),
  rebooking_review: reactSurface(RebookingReview),
  boarding_pass: reactSurface(BoardingPass),
  // booking the flight home
  flight_search: reactSurface(FlightSearch),
  flight_results: reactSurface(FlightResults),
  fare_options: reactSurface(FareOptions),
  booking_review: reactSurface(BookingReview),
  booking_confirmed: reactSurface(BookingConfirmed),
};

export const notices = {
  flight_cancelled: reactNotice(FlightCancelled),
  seat_confirmed: reactNotice(SeatConfirmed),
  ticket_issued: reactNotice(TicketIssued),
};
