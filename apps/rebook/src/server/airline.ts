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
import { CANCEL_REASON, DAYS_HOME, MIN_STAY_MIN, OPTIONS, TRIP, flightsHome, ticketNumber, tokyoMinutes, usd } from "./data.ts";
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
  /** How much the airline has raised each fare, by day, flight and fare: `Sun:r01:basic`. A flight's id is the same every day. */
  rises: Map<string, number>;
  review: { handle: string; props: BookingReviewProps } | null;
  /** The total the traveller confirmed, once they have. */
  confirmed: number | null;
  ticket: BookingConfirmedProps | null;
}

interface Desk {
  /** The trip card's latest handle, and the props it shows. */
  trip: string;
  tripProps: TripCardProps;
  /**
   * What the trip card should show: the props with every revision decided so
   * far, landed or not. A revision starts from these, and a card shown again
   * shows them, without waiting for a revision that may be waiting for the
   * very turn that shows it.
   */
  tripTarget: TripCardProps;
  /** The trip card's revisions, and the handle of a card shown again, one at a time, in order. */
  tripQueue: Promise<void>;
  /** A fare rise in progress: a second at once waits for none. */
  raising: boolean;
  cancelled: boolean;
  /** What the airline has: whether it still holds seats for the traveller, and the seats left on each option. */
  stock: { held: boolean; seats: Map<string, number> };
  /** A release in progress: a second, from the button and the timer at once, waits for none. */
  releasing: boolean;
  /** Each departure's seats as the traveller last saw them, other passengers' included, by day and flight: `Sun:JL 2`. */
  seatMaps: Map<string, SeatMapProps["rows"]>;
  options: { handle: string; props: RebookingOptionsProps; hold: ReturnType<typeof setTimeout> } | null;
  seats: { handle: string; props: SeatMapProps; key: string; others: ReturnType<typeof setInterval> } | null;
  /** The boarding pass's latest handle, and the props it shows. */
  pass: { handle: string; props: BoardingPassProps } | null;
  /** What the pass should show, with every gate change decided so far: as `tripTarget` is to the trip card. */
  passTarget: BoardingPassProps | null;
  /** The pass's revisions, and the handle of a pass shown again, one at a time, in order. */
  passQueue: Promise<void>;
  /**
   * What the traveller clicked. `confirmed` is the extra fare they confirmed
   * on the review, for an option that costs extra; any change since clears it.
   */
  chosen: { option: RebookOption | null; seat: string | null; care: string | null; confirmed: number | null };
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
 * start from props the other is about to replace. What the card should show
 * is decided now; the revision lands when HaiKIT lets it, which is after any
 * turn in progress, on whichever copy is the latest by then.
 */
function reviseTrip(conversationId: string, d: Desk, change: (props: TripCardProps) => TripCardProps, model: string): Promise<void> {
  const props = change(d.tripTarget);
  d.tripTarget = props;
  const run = async () => {
    const revised = await update!(conversationId, tripCardServer, d.trip, props, { model });
    d.trip = revised.handle;
    d.tripProps = props;
  };
  const done = d.tripQueue.then(run);
  d.tripQueue = done.catch(() => {
    // not revised: unless a later revision has been decided since, the card should show what it does
    if (d.tripTarget === props) d.tripTarget = d.tripProps;
  });
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
    tripTarget: TRIP,
    tripQueue: Promise.resolve(),
    raising: false,
    cancelled: false,
    stock: { held: true, seats: new Map(OPTIONS.map((o) => [o.id, o.seatsLeft])) },
    releasing: false,
    seatMaps: new Map(),
    options: null,
    seats: null,
    pass: null,
    passTarget: null,
    passQueue: Promise.resolve(),
    chosen: { option: null, seat: null, care: null, confirmed: null },
    booking: noBooking(),
  });
}

/**
 * Where a departure's seats are kept: its day and flight. The same flight on
 * another day is another plane, with its own seats.
 */
export const seatKey = (depart: string, flight: string) => `${depart.slice(0, 3)}:${flight}`;

/** A departure's seats as this traveller last saw them, or null before its map was first shown. */
export const seatsFor = (conversationId: string, key: string) => desks.get(conversationId)?.seatMaps.get(key) ?? null;

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

export function seatsShown(conversationId: string, handle: string, props: SeatMapProps, key: string) {
  const d = desks.get(conversationId);
  if (!d) return;
  if (d.seats) clearInterval(d.seats.others);
  d.seatMaps.set(key, props.rows);
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
        d.seats = { handle: r.handle, props, key, others };
        d.seatMaps.set(key, props.rows);
      })
      .catch((err) => {
        clearInterval(others);
        if (!answered(err)) console.error(`seat map for ${conversationId} not revised: ${err.message}`);
      })
      .finally(() => (revising = false));
  }, SEAT_EVERY_MS);
  others.unref();
  d.seats = { handle, props, key, others };
}

export function optionChosen(conversationId: string, option: RebookOption) {
  const d = desks.get(conversationId);
  if (d) d.chosen = { option, seat: null, care: null, confirmed: null };
}

/** Record a seat on the option the traveller chose. False when the seat is on any other option's map. */
export function seatPicked(conversationId: string, optionId: string, seat: string): boolean {
  const d = desks.get(conversationId);
  if (d?.chosen.option?.id !== optionId) return false;
  d.chosen.seat = seat;
  d.chosen.confirmed = null; // a different seat is a different booking to confirm
  return true;
}

export function careChosen(conversationId: string, care: string) {
  const d = desks.get(conversationId);
  if (!d) return;
  d.chosen.care = care;
  d.chosen.confirmed = null;
}

/** Record the extra fare the traveller confirmed on the review, for the option they chose. */
export function extraConfirmed(conversationId: string, optionId: string, extraFare: number): boolean {
  const d = desks.get(conversationId);
  if (d?.chosen.option?.id !== optionId) return false;
  d.chosen.confirmed = extraFare;
  return true;
}

/** What the traveller clicked: the boarding pass is issued for exactly this. */
export const chosen = (conversationId: string) => desks.get(conversationId)?.chosen ?? null;

export function passShown(conversationId: string, handle: string, props: BoardingPassProps) {
  const d = desks.get(conversationId);
  if (!d) return;
  d.pass = { handle, props };
  d.passTarget = props;
  // Confirmed a moment later, beside the pass, as a webhook would.
  setTimeout(() => {
    notify?.(conversationId, seatConfirmedServer, { flight: props.flight, seat: props.seat, reference: props.reference }, { handle })
      .catch((err) => console.error(`seat confirmation for ${conversationId} not sent: ${err.message}`));
  }, CONFIRM_MS).unref();
}

/**
 * What's booked, for showing it again: the trip card and the boarding pass as
 * they should be, with every revision the airline has decided, and the flight
 * home's e-ticket. It doesn't wait for a revision to land: one may be waiting
 * for the very turn that asks. Null for a conversation the airline doesn't know.
 */
export function bookingsNow(conversationId: string) {
  const d = desks.get(conversationId);
  if (!d) return null;
  return { trip: d.tripTarget, pass: d.passTarget, ticket: d.booking.ticket };
}

/**
 * A card shown again is the one the airline revises from now on: the trip
 * card when the flight home is booked, the pass when its gate moves. Nothing
 * is confirmed again: the airline already did. It takes its place in the
 * card's queue: a revision decided before it lands first, on the copy it
 * started on, and this copy, drawn as the card should be, already shows it. A
 * revision decided while it was being drawn lands on the copy before it too,
 * so this one is then revised to match.
 */
export function tripShownAgain(conversationId: string, handle: string, shown: TripCardProps) {
  const d = desks.get(conversationId);
  if (!d) return;
  d.tripQueue = d.tripQueue
    .then(async () => {
      d.trip = handle;
      d.tripProps = shown;
      if (d.tripTarget === shown) return;
      const props = d.tripTarget;
      const revised = await update!(conversationId, tripCardServer, handle, props, { model: "The trip card shown again now has the airline's latest change too." });
      d.trip = revised.handle;
      d.tripProps = props;
    })
    .catch((err) => console.error(`trip card shown again for ${conversationId} not brought up to date: ${err.message}`));
}

/** The boarding pass issued in this conversation, as it should be now, or null. */
export const issuedPass = (conversationId: string) => desks.get(conversationId)?.passTarget ?? null;

/** As `tripShownAgain`, for the boarding pass: the gate change it might have missed is applied to it. */
export function passShownAgain(conversationId: string, handle: string, shown: BoardingPassProps) {
  const d = desks.get(conversationId);
  if (!d) return;
  d.passQueue = d.passQueue
    .then(async () => {
      d.pass = { handle, props: shown };
      if (!d.passTarget || d.passTarget === shown) return;
      const props = d.passTarget;
      const revised = await update!(conversationId, boardingPassServer, handle, props, { model: `The boarding pass shown again now shows gate ${props.gate} too.` });
      d.pass = { handle: revised.handle, props };
    })
    .catch((err) => console.error(`boarding pass shown again for ${conversationId} not brought up to date: ${err.message}`));
}

// ─────────────────────────────────────────── booking the flight home

/** The flight home as far as it's booked, or null for a conversation the airline doesn't know. */
export const booking = (conversationId: string) => desks.get(conversationId)?.booking ?? null;

/** A fare at its price now, with whatever the airline has added to it. */
/** Where a fare's raises are kept: the same flight on another day wasn't raised. */
const riseKey = (flight: HomeFlight, fare: { id: string }) => `${flight.depart.slice(0, 3)}:${flight.id}:${fare.id}`;

export function priced(conversationId: string, flight: HomeFlight, fare: Fare): Fare {
  const rise = desks.get(conversationId)?.booking.rises.get(riseKey(flight, fare)) ?? 0;
  return { ...fare, price: fare.price + rise };
}

/**
 * When the traveller lands in Tokyo: on the flight they were rebooked onto,
 * once its boarding pass is issued, otherwise on the trip as booked.
 */
export function outboundLands(conversationId: string): string {
  return desks.get(conversationId)?.pass?.props.arrive ?? TRIP.arrive;
}

/**
 * Whether landing in Tokyo at `arrive` leaves time for the flight home, once
 * that's ticketed: a rebooking that lands too late for it would strand the
 * ticket. True while there's no ticket.
 */
export function landsInTimeForHome(conversationId: string, arrive: string): boolean {
  const home = desks.get(conversationId)?.booking.ticket;
  return !home || tokyoMinutes(home.depart) >= tokyoMinutes(arrive) + MIN_STAY_MIN;
}

/** The flight home, once ticketed: its flight and when it leaves. */
export function homeTicket(conversationId: string): { flight: string; depart: string } | null {
  const home = desks.get(conversationId)?.booking.ticket;
  return home ? { flight: home.legs.map((l) => l.flight).join(" + "), depart: home.depart } : null;
}

/**
 * The days the flight home can leave on, now: those with a flight leaving long
 * enough after the traveller lands, each with the nights in Tokyo it gives.
 */
export function daysHome(conversationId: string): { id: Day; nights: number }[] {
  const landed = Math.floor(tokyoMinutes(outboundLands(conversationId)) / 1440);
  return DAYS_HOME.filter((day) => flightsHome(day).some((f) => leavesAfterLanding(conversationId, f))).map((id) => ({
    id,
    nights: Math.floor(tokyoMinutes(`${id} 00:00`) / 1440) - landed,
  }));
}

/** Whether a flight home leaves long enough after the traveller lands in Tokyo. */
export const leavesAfterLanding = (conversationId: string, flight: HomeFlight) =>
  tokyoMinutes(flight.depart) >= tokyoMinutes(outboundLands(conversationId)) + MIN_STAY_MIN;

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
  const was = d.passTarget;
  if (!was || !d.pass) throw new OpsError("There's no boarding pass yet: rebook the cancelled flight first.");
  // Decided now, so a pass shown again before it lands shows the new gate.
  const gate = `G${Number(was.gate.slice(1)) + 4}`;
  const props: BoardingPassProps = { ...was, gate };
  d.passTarget = props;
  const run = async () => {
    // the latest copy when it lands: a pass shown again since is the one that moves
    const revised = await update!(conversationId, boardingPassServer, d.pass!.handle, props, {
      model: `${props.flight} moved from gate ${was.gate} to gate ${gate}. Boarding is still ${props.boards}.`,
      wake: true,
    });
    d.pass = { handle: revised.handle, props };
  };
  const done = d.passQueue.then(run);
  d.passQueue = done.catch(() => {
    if (d.passTarget === props) d.passTarget = d.pass?.props ?? null;
  });
  await done;
  return `Moved ${props.flight} to gate ${gate}. The guide tells the traveller now, or with their next click if a question is waiting.`;
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
    const key = riseKey(b.flight, b.fare);
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
