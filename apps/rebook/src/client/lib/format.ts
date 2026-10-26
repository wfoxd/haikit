/** How the surfaces write times, money, days and airports. */

import type { Day, TokyoAirport } from "../../shared/surfaces.ts";

/** "16h45" */
export const later = (min: number) => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;

/** "$1,250" */
export const dollars = (n: number) => `$${n.toLocaleString("en-US")}`;

export const DAY_NAMES: Record<Day, string> = { Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday", Mon: "Monday" };

/** The airport on its button. */
export const AIRPORTS: Record<TokyoAirport, string> = { TYO: "Any Tokyo airport", NRT: "Narita · NRT", HND: "Haneda · HND" };

/** The airport in a sentence. */
export const FROM: Record<TokyoAirport, string> = { TYO: "any Tokyo airport", NRT: "Narita", HND: "Haneda" };
