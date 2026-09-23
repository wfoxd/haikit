import type { Flight } from "../shared/surfaces.ts";

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const AIRLINES: [string, string][] = [
  ["UA", "United"], ["NH", "ANA"], ["JL", "JAL"], ["ZG", "Zipair"], ["SQ", "Singapore"],
  ["DL", "Delta"], ["AC", "Air Canada"], ["KE", "Korean Air"], ["BR", "EVA Air"], ["PR", "Philippine"],
];

const hhmm = (mins: number) => {
  const m = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

export const dur = (mins: number) => `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, "0")}m`;
export const stopLabel = (n: number) => (n === 0 ? "nonstop" : n === 1 ? "1 stop" : `${n} stops`);

function build(): Flight[] {
  const rnd = mulberry32(20260314);
  const out: Flight[] = [];
  for (let i = 0; i < 47; i++) {
    const [code, airline] = AIRLINES[Math.floor(rnd() * AIRLINES.length)]!;
    const r = rnd();
    const stops = r < 0.26 ? 0 : r < 0.82 ? 1 : 2;
    const durationMin =
      stops === 0 ? 620 + Math.floor(rnd() * 70)
      : stops === 1 ? 790 + Math.floor(rnd() * 420)
      : 1120 + Math.floor(rnd() * 480);
    const price =
      stops === 0 ? 330 + Math.floor(rnd() * 560)
      : stops === 1 ? 215 + Math.floor(rnd() * 400)
      : 199 + Math.floor(rnd() * 250);
    const departMin = 5 * 60 + Math.floor(rnd() * 17 * 60);

    out.push({
      id: `${code}${100 + Math.floor(rnd() * 880)}`,
      airline,
      depart: hhmm(departMin),
      departMin,
      arrive: hhmm(departMin + durationMin + 16 * 60),
      durationMin,
      duration: dur(durationMin),
      stops,
      price,
      cabin: rnd() < 0.15 ? "Premium Economy" : "Economy",
    });
  }
  return out.sort((a, b) => a.departMin - b.departMin);
}

export const FLIGHTS = build();

export function seatRows(flightId: string) {
  const rnd = mulberry32([...flightId].reduce((a, c) => a + c.charCodeAt(0), 0));
  const rows = [];
  for (let r = 20; r <= 31; r++) {
    rows.push({
      row: r,
      seats: ["A", "B", "C", "D", "E", "F"].map((letter) => ({
        id: `${r}${letter}`,
        letter,
        taken: rnd() < 0.42,
        extraLegroom: r === 20 || r === 26,
        window: letter === "A" || letter === "F",
      })),
    });
  }
  return rows;
}
