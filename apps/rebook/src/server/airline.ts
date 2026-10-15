/**
 * The airline's side of the demo: what happens to a traveller that no request
 * of theirs asked for. It cancels the flight, lets its seat holds run out,
 * sells seats to other passengers, confirms a booking a moment later, and
 * moves a gate. Each reaches the conversation the way a webhook from a real
 * airline would: `hai.notify` for news, `hai.update` to revise what's already
 * on screen.
 *
 * It also keeps what the traveller clicked, so the boarding pass can only be
 * issued for the option, seat and night they chose. The model asks; the
 * traveller decides.
 */

import type { Notify, Update } from "@haikit/core";
import type { BoardingPassProps, RebookingOptionsProps, RebookOption, SeatMapProps } from "../shared/surfaces.ts";
import { CANCEL_REASON, OPTIONS, TRIP } from "./data.ts";
import { flightCancelledServer, seatConfirmedServer } from "./notices.ts";
import { boardingPassServer, rebookingOptionsServer, seatMapServer, tripCardServer } from "./surfaces.ts";

/** How long the airline holds a seat on each option for the traveller. */
export const HOLD_MS = 5 * 60_000;
/** How often another passenger takes a seat on the map the traveller is looking at, and how many do. */
const SEAT_EVERY_MS = 3_500;
const OTHER_PASSENGERS = 4;
/** How long the airline takes to confirm a seat. */
const CONFIRM_MS = 1_500;
/** Conversations whose state the airline keeps, the oldest dropped first. */
const MAX_DESKS = 5_000;

/** A request the airline can't act on now, with the reason, for the ops panel. */
export class OpsError extends Error {}

interface Desk {
  /** The trip card's latest handle. */
  trip: string;
  cancelled: boolean;
  /** What the airline has: whether it still holds seats for the traveller, and the seats left on each option. */
  stock: { held: boolean; seats: Map<string, number> };
  /** A release in progress: a second, from the button and the timer at once, waits for none. */
  releasing: boolean;
  /** Each flight's seats as the traveller last saw them, other passengers' included. */
  seatMaps: Map<string, SeatMapProps["rows"]>;
  options: { handle: string; props: RebookingOptionsProps; hold: ReturnType<typeof setTimeout> } | null;
  seats: { handle: string; props: SeatMapProps; others: ReturnType<typeof setInterval> } | null;
  pass: { handle: string; props: BoardingPassProps } | null;
  /** What the traveller clicked. */
  chosen: { option: RebookOption | null; seat: string | null; care: string | null };
}

const desks = new Map<string, Desk>();
let notify: Notify | null = null;
let update: Update | null = null;

/** Called once at startup with `hai.notify` and `hai.update`, which the airline answers through. */
export function connectAirline(send: Notify, revise: Update) {
  notify = send;
  update = revise;
}

const desk = (conversationId: string) => {
  const found = desks.get(conversationId);
  if (!found) throw new OpsError("This conversation hasn't shown its trip yet.");
  return found;
};

/** A revision the conversation has moved past is refused: the airline's message then says so. */
const answered = (err: unknown) => err instanceof Error && /was answered/.test(err.message);

// ─────────────────────────────────────────── what the tools tell it

export function tripShown(conversationId: string, handle: string) {
  if (desks.size >= MAX_DESKS) desks.delete(desks.keys().next().value!);
  desks.set(conversationId, {
    trip: handle,
    cancelled: false,
    stock: { held: true, seats: new Map(OPTIONS.map((o) => [o.id, o.seatsLeft])) },
    releasing: false,
    seatMaps: new Map(),
    options: null,
    seats: null,
    pass: null,
    chosen: { option: null, seat: null, care: null },
  });
}

/** A flight's seats as this traveller last saw them, or null before its map was first shown. */
export const seatsFor = (conversationId: string, flight: string) => desks.get(conversationId)?.seatMaps.get(flight) ?? null;

/** Every option as the airline has it now, and whether it still holds them: a new picker shows these. */
export function stock(conversationId: string): { held: boolean; options: RebookOption[] } {
  const s = desks.get(conversationId)?.stock;
  if (!s) return { held: true, options: OPTIONS };
  return { held: s.held, options: OPTIONS.map((o) => ({ ...o, seatsLeft: s.seats.get(o.id) ?? o.seatsLeft })) };
}

export function optionsShown(conversationId: string, handle: string, props: RebookingOptionsProps) {
  const d = desks.get(conversationId);
  if (!d) return;
  if (d.options) clearTimeout(d.options.hold);
  // The holds run out on their own: the ops panel's button only brings that forward.
  const hold = setTimeout(() => void releaseHolds(conversationId).catch(() => {}), HOLD_MS);
  hold.unref();
  d.options = { handle, props, hold };
}

export function seatsShown(conversationId: string, handle: string, props: SeatMapProps) {
  const d = desks.get(conversationId);
  if (!d) return;
  if (d.seats) clearInterval(d.seats.others);
  d.seatMaps.set(props.flight, props.rows);
  let left = OTHER_PASSENGERS;
  // one revision at a time: the next is drawn from the one before it
  let revising = false;
  const others = setInterval(() => {
    if (revising) return;
    const seats = d.seats;
    // Another passenger takes the frontmost free seat, window first: the
    // ones a traveller is most likely to want.
    const free = seats?.props.rows.flatMap((r) => r.seats).filter((s) => !s.taken) ?? [];
    const gone = free.find((s) => s.window) ?? free[0];
    if (!seats || !gone || left-- <= 0) return void clearInterval(others);
    const props: SeatMapProps = {
      ...seats.props,
      rows: seats.props.rows.map((r) => ({ ...r, seats: r.seats.map((s) => (s.id === gone.id ? { ...s, taken: true } : s)) })),
    };
    revising = true;
    update?.(conversationId, seatMapServer, seats.handle, props, { model: `Another passenger took seat ${gone.id}.` })
      .then((r) => {
        d.seats = { handle: r.handle, props, others };
        d.seatMaps.set(props.flight, props.rows);
      })
      .catch((err) => {
        clearInterval(others);
        if (!answered(err)) console.error(`seat map for ${conversationId} not revised: ${err.message}`);
      })
      .finally(() => (revising = false));
  }, SEAT_EVERY_MS);
  others.unref();
  d.seats = { handle, props, others };
}

export function optionChosen(conversationId: string, option: RebookOption) {
  const d = desks.get(conversationId);
  if (d) d.chosen = { option, seat: null, care: null };
}

export function seatPicked(conversationId: string, optionId: string, seat: string) {
  const d = desks.get(conversationId);
  if (d?.chosen.option?.id === optionId) d.chosen.seat = seat;
}

export function careChosen(conversationId: string, care: string) {
  const d = desks.get(conversationId);
  if (d) d.chosen.care = care;
}

/** What the traveller clicked: the boarding pass is issued for exactly this. */
export const chosen = (conversationId: string) => desks.get(conversationId)?.chosen ?? null;

export function passShown(conversationId: string, handle: string, props: BoardingPassProps) {
  const d = desks.get(conversationId);
  if (!d) return;
  d.pass = { handle, props };
  // Confirmed a moment later, beside the pass, as a webhook would.
  setTimeout(() => {
    notify?.(conversationId, seatConfirmedServer, { flight: props.flight, seat: props.seat, reference: props.reference }, { handle })
      .catch((err) => console.error(`seat confirmation for ${conversationId} not sent: ${err.message}`));
  }, CONFIRM_MS).unref();
}

// ─────────────────────────────────────────── what the ops panel asks of it

/** Cancel the flight: the trip card shows it, and a wake notice has the guide tell the traveller. */
export async function cancelFlight(conversationId: string): Promise<string> {
  const d = desk(conversationId);
  if (d.cancelled) throw new OpsError(`${TRIP.flight} is already cancelled.`);
  d.cancelled = true;
  try {
    const revised = await update!(conversationId, tripCardServer, d.trip, { ...TRIP, status: "cancelled", reason: CANCEL_REASON }, {
      model: `The airline marked ${TRIP.flight} cancelled.`,
    });
    d.trip = revised.handle;
    await notify!(conversationId, flightCancelledServer, { flight: TRIP.flight, depart: TRIP.depart, reason: CANCEL_REASON }, { handle: d.trip });
  } catch (err) {
    d.cancelled = false;
    throw err;
  }
  return `Cancelled ${TRIP.flight}. The guide hears of it now, and tells the traveller.`;
}

/** Let the seat holds run out now: seats left fall on every option, and one sells out. */
export async function releaseHolds(conversationId: string): Promise<string> {
  const d = desk(conversationId);
  const shown = d.options;
  if (!shown) throw new OpsError("No rebooking options are on screen yet.");
  if (!d.stock.held) throw new OpsError("The holds are already released.");
  if (d.releasing) throw new OpsError("The holds are being released already.");
  // The scarcest option on screen sells out; every other loses a seat or two.
  // Worked out on a copy: the airline's stock changes only once the picker on
  // screen shows it, so a release that fails leaves both as they were.
  const scarce = [...shown.props.options].sort((a, b) => a.seatsLeft - b.seatsLeft)[0];
  const seats = new Map(d.stock.seats);
  OPTIONS.forEach((o, i) => {
    const left = seats.get(o.id) ?? o.seatsLeft;
    seats.set(o.id, o.id === scarce?.id ? 0 : Math.max(1, left - (i % 3 === 2 ? 2 : 1)));
  });
  const options = shown.props.options.map((o) => ({ ...o, seatsLeft: seats.get(o.id) ?? o.seatsLeft }));
  const props: RebookingOptionsProps = { ...shown.props, options, held: false };
  d.releasing = true;
  try {
    const revised = await update!(conversationId, rebookingOptionsServer, shown.handle, props, {
      model:
        `The airline's 5-minute holds ran out: seats left fell on every option` +
        (scarce ? `, and ${scarce.flights.join(" + ")} sold out.` : "."),
    });
    clearTimeout(shown.hold);
    d.stock = { held: false, seats };
    d.options = { handle: revised.handle, props, hold: shown.hold };
  } catch (err) {
    if (answered(err)) throw new OpsError("The traveller has already chosen, so nothing is on hold.");
    throw err;
  } finally {
    d.releasing = false;
  }
  return `Released the holds${scarce ? `: ${scarce.flights.join(" + ")} sold out` : ""}. The picker shows it now; the guide hears of it with the traveller's next click.`;
}

/** Move the new flight's gate: the boarding pass is revised, and the guide speaks up about it. */
export async function changeGate(conversationId: string): Promise<string> {
  const d = desk(conversationId);
  const pass = d.pass;
  if (!pass) throw new OpsError("There's no boarding pass yet: book a new flight first.");
  const gate = `G${Number(pass.props.gate.slice(1)) + 4}`;
  const props: BoardingPassProps = { ...pass.props, gate };
  const revised = await update!(conversationId, boardingPassServer, pass.handle, props, {
    model: `${props.flight} moved from gate ${pass.props.gate} to gate ${gate}. Boarding is still ${props.boards}.`,
    wake: true,
  });
  d.pass = { handle: revised.handle, props };
  return `Moved ${props.flight} to gate ${gate}. The guide tells the traveller now.`;
}
