/**
 * The airline's side of the demo: what happens to a traveller that no request
 * of theirs asked for. It cancels the flight, lets its seat holds run out,
 * sells seats to other passengers, confirms a booking a moment later, and
 * moves a gate. Each reaches the conversation the way a webhook from a real
 * airline would: `hai.notify` for news, `hai.update` to revise what's already
 * on screen.
 *
 * For the flight home, it raises a fare while the traveller is reviewing it,
 * issues the ticket a moment after the booking, and shows the flight home on
 * the trip card.
 *
 * It also keeps what the traveller clicked, so the boarding pass can only be
 * issued for the option, seat and night they chose, and the flight home
 * booked for the flight, fare, seat and total they confirmed. The model
 * asks; the traveller decides.
 */

import type { Notify, Update } from "@haikit/core";
import type {
  BookingConfirmedProps,
  BookingReviewProps,
  Day,
  Fare,
  HomeFlight,
  RebookingOptionsProps,
  RebookOption,
  SeatMapProps,
  TokyoAirport,
  TripCardProps,
  BoardingPassProps,
} from "../shared/surfaces.ts";
import { CANCEL_REASON, OPTIONS, TRIP, ticketNumber, usd } from "./data.ts";
import { flightCancelledServer, seatConfirmedServer, ticketIssuedServer } from "./notices.ts";
import { boardingPassServer, bookingReviewServer, rebookingOptionsServer, seatMapServer, tripCardServer } from "./surfaces.ts";

/** How long the airline holds a seat on each option for the traveller. */
export const HOLD_MS = 5 * 60_000;
/** How often another passenger takes a seat on the map the traveller is looking at, and how many do. */
const SEAT_EVERY_MS = 3_500;
const OTHER_PASSENGERS = 4;
/** How long the airline takes to confirm a seat, or issue a ticket. */
const CONFIRM_MS = 1_500;
/** How much the airline raises a fare by, each time the ops panel asks. */
export const FARE_RISE = 60;
/** Conversations whose state the airline keeps, the oldest dropped first. */
const MAX_DESKS = 5_000;

/** A request the airline can't act on now, with the reason, for the ops panel. */
export class OpsError extends Error {}

/** The flight home, as far as the traveller has booked it: each step clears the ones after it. */
interface Booking {
  search: { from: TokyoAirport; date: Day } | null;
  flight: HomeFlight | null;
  fare: Fare | null;
  seat: string | null;
  /** How much the airline has raised each fare, by flight and fare: `r01:basic`. */
  rises: Map<string, number>;
  review: { handle: string; props: BookingReviewProps } | null;
  /** The total the traveller confirmed, once they have. */
  confirmed: number | null;
  ticket: BookingConfirmedProps | null;
}

interface Desk {
  /** The trip card's latest handle, and its props: a revision starts from these. */
  trip: string;
  tripProps: TripCardProps;
  /** The trip card's revisions, one at a time: each reads the props the last one saved. */
  tripQueue: Promise<void>;
  /** A fare rise in progress: a second at once waits for none. */
  raising: boolean;
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
  booking: Booking;
}

const noBooking = (): Booking => ({ search: null, flight: null, fare: null, seat: null, rises: new Map(), review: null, confirmed: null, ticket: null });

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

/**
 * Revise the trip card, after any revision of it already under way: the
 * cancellation and the flight home each change one thing, and neither may
 * start from props the other is about to replace.
 */
function reviseTrip(conversationId: string, d: Desk, change: (props: TripCardProps) => TripCardProps, model: string): Promise<void> {
  const run = async () => {
    const props = change(d.tripProps);
    const revised = await update!(conversationId, tripCardServer, d.trip, props, { model });
    d.trip = revised.handle;
    d.tripProps = props;
  };
  const done = d.tripQueue.then(run);
  d.tripQueue = done.catch(() => {});
  return done;
}

/** A revision the conversation has moved past is refused: the airline's message then says so. */
const answered = (err: unknown) => err instanceof Error && /was answered/.test(err.message);

// ─────────────────────────────────────────── what the tools tell it

export function tripShown(conversationId: string, handle: string) {
  if (desks.size >= MAX_DESKS) desks.delete(desks.keys().next().value!);
  desks.set(conversationId, {
    trip: handle,
    tripProps: TRIP,
    tripQueue: Promise.resolve(),
    raising: false,
    cancelled: false,
    stock: { held: true, seats: new Map(OPTIONS.map((o) => [o.id, o.seatsLeft])) },
    releasing: false,
    seatMaps: new Map(),
    options: null,
    seats: null,
    pass: null,
    chosen: { option: null, seat: null, care: null },
    booking: noBooking(),
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

/** Record a seat on the option the traveller chose. False when the seat is on any other option's map. */
export function seatPicked(conversationId: string, optionId: string, seat: string): boolean {
  const d = desks.get(conversationId);
  if (d?.chosen.option?.id !== optionId) return false;
  d.chosen.seat = seat;
  return true;
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

// ─────────────────────────────────────────── booking the flight home

/** The flight home as far as it's booked, or null for a conversation the airline doesn't know. */
export const booking = (conversationId: string) => desks.get(conversationId)?.booking ?? null;

/** A fare at its price now, with whatever the airline has added to it. */
export function priced(conversationId: string, flight: HomeFlight, fare: Fare): Fare {
  const rise = desks.get(conversationId)?.booking.rises.get(`${flight.id}:${fare.id}`) ?? 0;
  return { ...fare, price: fare.price + rise };
}

/** The traveller searched: what they had chosen after it no longer stands. */
export function searched(conversationId: string, search: { from: TokyoAirport; date: Day }) {
  const d = desks.get(conversationId);
  if (d) d.booking = { ...noBooking(), rises: d.booking.rises, ticket: d.booking.ticket, search };
}

export function homeFlightChosen(conversationId: string, flight: HomeFlight) {
  const b = booking(conversationId);
  if (b) Object.assign(b, { flight, fare: null, seat: null, review: null, confirmed: null });
}

export function fareChosen(conversationId: string, fare: Fare) {
  const b = booking(conversationId);
  if (b) Object.assign(b, { fare, seat: null, review: null, confirmed: null });
}

/** Record a seat on the flight home. False when the seat is on any other flight's map. */
export function homeSeatPicked(conversationId: string, flightId: string, seat: string): boolean {
  const b = booking(conversationId);
  if (b?.flight?.id !== flightId || !b.fare?.seatChoice) return false;
  Object.assign(b, { seat, review: null, confirmed: null });
  return true;
}

export function reviewShown(conversationId: string, handle: string, props: BookingReviewProps) {
  const b = booking(conversationId);
  if (b) b.review = { handle, props };
}

export function bookingConfirmedAt(conversationId: string, total: number) {
  const b = booking(conversationId);
  if (b) b.confirmed = total;
}

/**
 * The ticket is on screen. The airline issues it a moment later, as a webhook
 * would, and the trip card is revised to show the flight home.
 */
export function ticketShown(conversationId: string, handle: string, props: BookingConfirmedProps) {
  const d = desks.get(conversationId);
  if (!d) return;
  d.booking.ticket = props;
  const flight = props.legs.map((l) => l.flight).join(" + ");
  setTimeout(async () => {
    try {
      const home = { flight, depart: props.depart, reference: props.reference };
      await reviseTrip(conversationId, d, (trip) => ({ ...trip, home }), `The trip card now shows the flight home, ${flight}.`);
      await notify!(conversationId, ticketIssuedServer, { reference: props.reference, ticket: ticketNumber(), flight }, { handle });
    } catch (err) {
      console.error(`ticket for ${conversationId} not issued: ${(err as Error).message}`);
    }
  }, CONFIRM_MS).unref();
}

// ─────────────────────────────────────────── what the ops panel asks of it

/** Cancel the flight: the trip card shows it, and a wake notice has the guide tell the traveller. */
export async function cancelFlight(conversationId: string): Promise<string> {
  const d = desk(conversationId);
  if (d.cancelled) throw new OpsError(`${TRIP.flight} is already cancelled.`);
  d.cancelled = true;
  try {
    await reviseTrip(conversationId, d, (trip) => ({ ...trip, status: "cancelled", reason: CANCEL_REASON }), `The airline marked ${TRIP.flight} cancelled.`);
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
  if (!pass) throw new OpsError("There's no boarding pass yet: rebook the cancelled flight first.");
  const gate = `G${Number(pass.props.gate.slice(1)) + 4}`;
  const props: BoardingPassProps = { ...pass.props, gate };
  const revised = await update!(conversationId, boardingPassServer, pass.handle, props, {
    model: `${props.flight} moved from gate ${pass.props.gate} to gate ${gate}. Boarding is still ${props.boards}.`,
    wake: true,
  });
  d.pass = { handle: revised.handle, props };
  return `Moved ${props.flight} to gate ${gate}. The guide tells the traveller now.`;
}

/**
 * Raise the fare the traveller is reviewing: the review is revised in place to
 * the new total. No turn can start while a question waits, so the guide hears
 * of it with the traveller's next click; a Confirm at the old total is refused.
 */
export async function raiseFare(conversationId: string): Promise<string> {
  const d = desk(conversationId);
  const b = d.booking;
  const shown = b.review;
  if (!shown || !b.flight || !b.fare) throw new OpsError("No booking is waiting on its review yet: start booking the flight home.");
  if (b.confirmed !== null) throw new OpsError("The traveller has already confirmed: the fare is theirs.");
  // From reading the review to saving the rise, one at a time: two at once
  // would both start from the same total, and the rise would count twice.
  if (d.raising) throw new OpsError("The fare is being raised already.");
  const old = shown.props.price;
  const props: BookingReviewProps = {
    ...shown.props,
    price: { ...old, fare: old.fare + FARE_RISE, total: old.total + FARE_RISE },
    previousTotal: shown.props.previousTotal ?? old.total,
  };
  d.raising = true;
  try {
    const revised = await update!(conversationId, bookingReviewServer, shown.handle, props, {
      model:
        `The airline raised the ${b.fare.name} fare on ${b.flight.flights.join(" + ")} by ${usd(FARE_RISE)} while the traveller was reviewing: ` +
        `the total is now ${usd(props.price.total)}, up from ${usd(old.total)}.`,
    });
    const key = `${b.flight.id}:${b.fare.id}`;
    b.rises.set(key, (b.rises.get(key) ?? 0) + FARE_RISE);
    b.fare = { ...b.fare, price: b.fare.price + FARE_RISE };
    b.review = { handle: revised.handle, props };
  } catch (err) {
    if (answered(err)) throw new OpsError("The traveller has already answered the review.");
    throw err;
  } finally {
    d.raising = false;
  }
  return `Raised the ${b.fare.name} fare by ${usd(FARE_RISE)}: the review shows ${usd(props.price.total)} now. The guide hears of it with the traveller's next click.`;
}
