import "./globals.css";
import { createRoot } from "react-dom/client";
import { mountChat } from "@haikit/client/app.js";
import { notices, registry } from "./components.tsx";
import { OpsBar } from "./ops.tsx";

const root = document.querySelector<HTMLElement>("#app")!;

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

// The Airline ops bar plays the airline. mountChat draws the header, so the
// bar is a React root of its own: just under the header, or at the top if a
// later mountChat draws none.
const bar = document.createElement("div");
bar.className = "flex-none";
const top = root.querySelector(".hai-top");
if (top) top.after(bar);
else root.prepend(bar);
createRoot(bar).render(<OpsBar chat={chat} />);
