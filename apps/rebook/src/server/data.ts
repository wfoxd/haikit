/**
 * The demo's world: one booking, and every way to Tokyo once it's cancelled.
 * Made up, and the same on every run, so the demo and its test always tell
 * the same story.
 */

import type { CareOptionsProps, RebookOption, SeatMapProps, TripCardProps } from "../shared/surfaces.ts";

export const TRIP: TripCardProps = {
  passenger: "Alex Morgan",
  reference: "K7Q2MX",
  flight: "UA 837",
  airline: "United",
  from: { code: "SFO", city: "San Francisco" },
  to: { code: "NRT", city: "Tokyo Narita" },
  depart: "Tue 18:05",
  arrive: "Wed 21:40",
  seat: "32K",
  status: "on-time",
  reason: null,
};

export const CANCEL_REASON = "a crew shortage";

/** When the cancelled flight would have landed, in minutes into Tokyo's week from Monday 00:00. */
const LANDED = (2 * 24 + 21) * 60 + 40; // Wed 21:40
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const clock = (minutes: number) =>
  `${DAYS[Math.floor(minutes / 1440) % 7]} ${String(Math.floor((minutes % 1440) / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** "7h45": how much later an option lands. */
export const later = (minutes: number) => `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}`;

type Def = Omit<RebookOption, "arrive">;
const DEFS: Def[] = [
  { id: "o01", flights: ["UA 1720", "NH 105"], airline: "United + ANA", via: "LAX", to: "HND", depart: "Tue 19:10", tonight: true, laterMin: 465, extraFare: 0, seatsLeft: 4 },
  { id: "o02", flights: ["AC 744", "AC 3"], airline: "Air Canada", via: "YVR", to: "NRT", depart: "Tue 20:05", tonight: true, laterMin: 520, extraFare: 0, seatsLeft: 6 },
  { id: "o03", flights: ["ZG 25"], airline: "Zipair", via: null, to: "NRT", depart: "Tue 22:35", tonight: true, laterMin: 235, extraFare: 140, seatsLeft: 9 },
  { id: "o04", flights: ["KE 26", "KE 2101"], airline: "Korean Air", via: "ICN", to: "HND", depart: "Tue 23:30", tonight: true, laterMin: 700, extraFare: 60, seatsLeft: 6 },
  { id: "o05", flights: ["NH 7"], airline: "ANA", via: null, to: "NRT", depart: "Wed 11:00", tonight: false, laterMin: 1005, extraFare: 0, seatsLeft: 5 },
  { id: "o06", flights: ["UA 875"], airline: "United", via: null, to: "HND", depart: "Wed 10:30", tonight: false, laterMin: 975, extraFare: 0, seatsLeft: 2 },
  { id: "o07", flights: ["JL 1"], airline: "JAL", via: null, to: "HND", depart: "Wed 12:45", tonight: false, laterMin: 1120, extraFare: 210, seatsLeft: 7 },
  { id: "o08", flights: ["UA 837"], airline: "United", via: null, to: "NRT", depart: "Wed 18:05", tonight: false, laterMin: 1440, extraFare: 0, seatsLeft: 11 },
  { id: "o09", flights: ["AC 750", "AC 3"], airline: "Air Canada", via: "YVR", to: "NRT", depart: "Wed 07:00", tonight: false, laterMin: 1060, extraFare: 0, seatsLeft: 8 },
  { id: "o10", flights: ["UA 1981", "UA 32"], airline: "United", via: "LAX", to: "NRT", depart: "Wed 08:00", tonight: false, laterMin: 1085, extraFare: 0, seatsLeft: 3 },
  { id: "o11", flights: ["DL 2209", "DL 167"], airline: "Delta", via: "SEA", to: "HND", depart: "Wed 06:00", tonight: false, laterMin: 1010, extraFare: 95, seatsLeft: 12 },
  { id: "o12", flights: ["BR 27", "BR 198"], airline: "EVA Air", via: "TPE", to: "NRT", depart: "Tue 23:55", tonight: true, laterMin: 875, extraFare: 120, seatsLeft: 5 },
  { id: "o13", flights: ["CX 893", "CX 500"], airline: "Cathay Pacific", via: "HKG", to: "HND", depart: "Tue 23:15", tonight: true, laterMin: 805, extraFare: 180, seatsLeft: 4 },
  { id: "o14", flights: ["UA 2112", "NH 177"], airline: "United + ANA", via: "SEA", to: "NRT", depart: "Wed 09:20", tonight: false, laterMin: 1150, extraFare: 0, seatsLeft: 7 },
];

/** Every way there, the one that lands first first. */
export const OPTIONS: RebookOption[] = DEFS.map((d) => ({ ...d, arrive: clock(LANDED + d.laterMin) })).sort(
  (a, b) => a.laterMin - b.laterMin,
);

export const optionById = (id: string) => OPTIONS.find((o) => o.id === id) ?? null;

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rows 10 to 24 of a flight's economy cabin, with its taken seats seeded from the flight number. */
export function seatRows(flight: string): SeatMapProps["rows"] {
  const rnd = mulberry32([...flight].reduce((n, c) => n * 31 + c.charCodeAt(0), 7));
  return Array.from({ length: 15 }, (_, i) => {
    const row = 10 + i;
    return {
      row,
      seats: ["A", "B", "C", "D", "E", "F"].map((letter) => ({
        id: `${row}${letter}`,
        letter,
        taken: rnd() < 0.62,
        window: letter === "A" || letter === "F",
        extraLegroom: row === 10 || row === 18,
      })),
    };
  });
}

/** Where the traveller can spend the night before a flight that leaves tomorrow. */
export const CARE: CareOptionsProps["choices"] = [
  { id: "hotel", title: "Hotel voucher", detail: "Grand Hyatt at SFO tonight, with breakfast and the shuttle back" },
  { id: "lounge", title: "Lounge and dinner", detail: "United Club in Terminal 3 until 23:00, and a $40 meal voucher" },
  { id: "none", title: "I'll sort it myself", detail: "Keep your receipts: up to $200 back" },
];

/** A six-letter booking reference, without the letters people misread. */
export const bookingReference = () =>
  Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
