/**
 * The demo's world: one booking, every way to Tokyo once it's cancelled, and
 * the flights home. Made up, and the same on every run, so the demo and its
 * test always tell the same story.
 */

import type { CareOptionsProps, Day, Fare, FareId, HomeFlight, RebookOption, SeatMapProps, TripCardProps } from "../shared/surfaces.ts";

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
  home: null,
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

// ───────────────────────────────────────────── the flights home

/** The days the flight home can leave, and how many nights in Tokyo each gives: the outbound lands Wednesday night. */
export const DAYS_HOME: { id: Day; nights: number }[] = [
  { id: "Thu", nights: 1 },
  { id: "Fri", nights: 2 },
  { id: "Sat", nights: 3 },
  { id: "Sun", nights: 4 },
  { id: "Mon", nights: 5 },
];
export const DAY_NAMES: Record<Day, string> = { Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday", Mon: "Monday" };
export const AIRPORT_NAMES = { TYO: "any Tokyo airport", NRT: "Tokyo Narita", HND: "Tokyo Haneda" } as const;
export const HOME = { code: "SFO", city: "San Francisco" };

/** The days of the trip in order, Tuesday's departure to next Monday: a day and time sort by them. */
const TRIP_DAYS = ["Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Mon"];
/** "Thu 14:25", Tokyo time, as minutes from the start of the trip's Tuesday. */
export function tokyoMinutes(dayTime: string): number {
  const [day, time] = dayTime.split(" ");
  const [h, m] = (time ?? "0:0").split(":").map(Number) as [number, number];
  return TRIP_DAYS.indexOf(day!) * 1440 + h * 60 + m;
}
/** The least time between landing in Tokyo and the flight home leaving: through the airport and back. */
export const MIN_STAY_MIN = 2 * 60;

/** How fares move with the day: weekends cost more. */
const DAY_PRICE: Record<Day, number> = { Thu: 1, Fri: 1.12, Sat: 1.05, Sun: 1.18, Mon: 0.94 };
/** Taxes and fees on every fare, the same for each. */
export const TAXES = 68;

type HomeDef = Omit<HomeFlight, "depart" | "arrive" | "price" | "seatsLeft"> & { leaves: string; base: number };
const HOME_DEFS: HomeDef[] = [
  { id: "r01", flights: ["UA 838"], airline: "United", from: "NRT", via: null, leaves: "16:55", durationMin: 595, base: 812 },
  { id: "r02", flights: ["NH 8"], airline: "ANA", from: "NRT", via: null, leaves: "17:00", durationMin: 590, base: 865 },
  { id: "r03", flights: ["JL 2"], airline: "JAL", from: "HND", via: null, leaves: "18:05", durationMin: 600, base: 890 },
  { id: "r04", flights: ["UA 876"], airline: "United", from: "HND", via: null, leaves: "15:40", durationMin: 585, base: 845 },
  { id: "r05", flights: ["ZG 26"], airline: "Zipair", from: "NRT", via: null, leaves: "15:00", durationMin: 610, base: 498 },
  { id: "r06", flights: ["NH 106", "UA 1205"], airline: "ANA + United", from: "HND", via: "LAX", leaves: "10:05", durationMin: 760, base: 655 },
  { id: "r07", flights: ["KE 704", "KE 25"], airline: "Korean Air", from: "NRT", via: "ICN", leaves: "09:30", durationMin: 860, base: 640 },
  { id: "r08", flights: ["CX 527", "CX 872"], airline: "Cathay Pacific", from: "HND", via: "HKG", leaves: "08:55", durationMin: 1050, base: 705 },
  { id: "r09", flights: ["DL 166", "DL 2433"], airline: "Delta", from: "HND", via: "SEA", leaves: "18:30", durationMin: 720, base: 760 },
  { id: "r10", flights: ["AC 4", "AC 735"], airline: "Air Canada", from: "NRT", via: "YVR", leaves: "17:45", durationMin: 700, base: 690 },
];

/** Tokyo is 16 hours ahead of San Francisco in October. */
const TOKYO_AHEAD_MIN = 16 * 60;
const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const round5 = (n: number) => Math.round(n / 5) * 5;

/** "$1,250" */
export const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

/** "9h55" */
export const duration = (minutes: number) => `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}`;

/**
 * Every flight home on a day, the earliest to leave first. Each leaves in
 * the morning or afternoon in Tokyo and, crossing the date line, lands in
 * San Francisco on the same day it left.
 */
export function flightsHome(day: Day): HomeFlight[] {
  const rnd = mulberry32([...day].reduce((n, c) => n * 31 + c.charCodeAt(0), 11));
  return HOME_DEFS.map(({ leaves, base, ...d }) => {
    const [h, m] = leaves.split(":").map(Number) as [number, number];
    const lands = h * 60 + m - TOKYO_AHEAD_MIN + d.durationMin;
    return {
      ...d,
      depart: `${day} ${leaves}`,
      arrive: `${day} ${hhmm(lands)}`,
      price: round5(base * DAY_PRICE[day]),
      seatsLeft: 1 + Math.floor(rnd() * 9),
    };
  }).sort((a, b) => a.depart.localeCompare(b.depart));
}

/** A flight home on a day, or null for no such flight. */
export const homeFlight = (day: Day, id: string) => flightsHome(day).find((f) => f.id === id) ?? null;

/** What each fare adds to the Basic price, and what it includes. */
const FARES: { id: FareId; name: string; add: number; seatChoice: boolean; includes: [string, boolean][]; bags: string }[] = [
  { id: "basic", name: "Basic", add: 0, seatChoice: false, bags: "carry-on only",
    includes: [["Carry-on bag", true], ["Checked bag", false], ["Choose your seat", false], ["Changes", false], ["Refund", false]] },
  { id: "standard", name: "Standard", add: 140, seatChoice: true, bags: "1 checked bag",
    includes: [["Carry-on and 1 checked bag", true], ["Choose your seat", true], ["Changes for $150", true], ["Refund", false]] },
  { id: "flex", name: "Flex", add: 420, seatChoice: true, bags: "2 checked bags",
    includes: [["Carry-on and 2 checked bags", true], ["Choose your seat", true], ["Free changes", true], ["Full refund", true]] },
];

/** The three fares on a flight, each at its price on that day. */
export const faresFor = (flight: HomeFlight): Fare[] =>
  FARES.map((f) => ({ id: f.id, name: f.name, price: flight.price + f.add, seatChoice: f.seatChoice, includes: f.includes.map(([text, yes]) => ({ text, yes })) }));

/** The bags a fare includes, in words. */
export const bagsFor = (fare: FareId) => FARES.find((f) => f.id === fare)!.bags;

/** How the booking is paid for. A demo: no card details are ever asked for, and nothing is charged. */
export const PAYMENT = `The card on file for ${TRIP.passenger}. This is a demo: nothing is charged.`;

/** A ticket number, as airlines print them: a three-digit airline code, then ten digits. */
export const ticketNumber = () => `016-${String(Math.floor(Math.random() * 1e10)).padStart(10, "0")}`;
