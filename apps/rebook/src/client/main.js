import "./styles.css";
import { mountChat } from "@haikit/client/app.js";
import { registry, notices } from "./components.js";
import { mountOps } from "./ops.js";

const root = /** @type {HTMLElement} */ (document.querySelector("#app"));

const chat = mountChat({
  root,
  // trip_card, rebooking_options, seat_map, care_options, boarding_pass, and for
  // the flight home, flight_search, flight_results, fare_options, booking_review,
  // booking_confirmed
  registry,
  notices, // flight_cancelled, seat_confirmed, ticket_issued
  title: "Rebook",
  subtitle: "a HaiKIT demo · AI drives, you steer",
  placeholder: "Try “book my flight home on Sunday”, or “which are nonstop?”",
});

// The Airline ops bar under the header plays the airline.
mountOps(root, chat);
