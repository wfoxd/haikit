/**
 * The Airline ops panel: a bar under the header that plays the airline.
 *
 * It isn't part of the conversation. Its buttons call the demo server's
 * /ops routes, which act on this conversation the way an airline's systems
 * would: a notice for news, a revision for what's already on screen. So you
 * watch the outside world act, then the AI respond.
 *
 * Nothing happens until the airline acts, so a visitor who doesn't press
 * anything isn't left waiting: 30 seconds after the trip opens, the panel
 * cancels the flight itself, through the same route as its button. A visitor
 * who starts booking the flight home is doing something already, so then it
 * doesn't.
 */

/** @typedef {import("@haikit/client").Chat} Chat */

/** What each button asks the airline to do. */
const ACTIONS = [
  { route: "cancel", label: "Cancel the flight", hint: "The airline cancels UA 837. The guide hears of it and speaks first." },
  { route: "release", label: "Release the holds", hint: "The 5-minute seat holds run out now: seats left fall, and one option sells out." },
  { route: "gate", label: "Change the gate", hint: "The new flight's gate moves. The boarding pass is revised, and the guide speaks up." },
  { route: "fare", label: "Raise the fare", hint: "While you review the flight home, its fare goes up $60. The review is revised in place; a Confirm at the old total is refused." },
];

/** How long after the trip opens the airline cancels the flight by itself. */
const AUTO_CANCEL_MS = 30_000;

/**
 * @param {HTMLElement} root the element mountChat drew in
 * @param {Chat} chat
 */
export function mountOps(root, chat) {
  const bar = document.createElement("section");
  bar.className = "ops";
  bar.setAttribute("aria-label", "Airline ops: plays the airline");

  const label = document.createElement("p");
  label.className = "ops-label";
  label.textContent = "Airline ops";
  const note = document.createElement("span");
  note.className = "ops-note";
  note.textContent = "plays the airline";
  label.append(note);

  const buttons = document.createElement("div");
  buttons.className = "ops-buttons";
  const status = document.createElement("p");
  status.className = "ops-status";
  status.setAttribute("aria-live", "polite");
  status.textContent = "Start here: cancel the flight.";

  /** @param {string} text @param {boolean} [refused] */
  const say = (text, refused = false) => {
    status.textContent = text;
    status.classList.toggle("is-refused", refused);
  };

  let busy = false;
  /**
   * Ask the airline to do something to this conversation.
   * @param {(typeof ACTIONS)[number]} action
   * @param {string} [lead] said before the airline's answer
   */
  const run = async (action, lead = "") => {
    const conversationId = chat.state.conversationId;
    if (busy || !conversationId) return;
    busy = true;
    bar.classList.add("is-busy");
    try {
      const res = await fetch(`/ops/${action.route}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId }),
      });
      const body = await res.json().catch(() => ({}));
      say(`${lead}${body.message ?? `The airline answered ${res.status}.`}`, !res.ok);
    } catch {
      say("The airline couldn't be reached.", true);
    } finally {
      busy = false;
      bar.classList.remove("is-busy");
    }
  };

  /** @type {HTMLButtonElement | null} */
  let cancelButton = null;
  for (const action of ACTIONS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ops-button";
    b.textContent = action.label;
    b.title = action.hint;
    b.onclick = () => {
      // Another request is still going, so this click does nothing: leave the
      // countdown be, or nothing would cancel the flight.
      if (busy) return;
      if (action.route === "cancel") {
        cancelling = true;
        stopCountdown();
      }
      void run(action);
    };
    if (action.route === "cancel") cancelButton = b;
    buttons.append(b);
  }

  // ── the airline cancels by itself, if nobody does ─────────────────────
  /** @type {{ conversationId: string, tick: ReturnType<typeof setInterval>, due: ReturnType<typeof setTimeout> } | null} */
  let countdown = null;
  /** The countdown stands down: a cancellation was sent or seen, or the visitor is booking the flight home. */
  let cancelling = false;
  /** The conversation the countdown last started for: it starts once, with the trip that opens it. */
  let counted = /** @type {string | null} */ (null);
  const clock = document.createElement("span");
  clock.className = "ops-countdown";
  // the status line says it once; a number read out every second would drown it
  clock.setAttribute("aria-hidden", "true");

  function stopCountdown() {
    if (!countdown) return;
    clearInterval(countdown.tick);
    clearTimeout(countdown.due);
    countdown = null;
    clock.remove();
  }

  /** @param {string} conversationId */
  const startCountdown = (conversationId) => {
    stopCountdown();
    cancelling = false;
    counted = conversationId;
    const ends = Date.now() + AUTO_CANCEL_MS;
    const show = () => (clock.textContent = `${Math.max(0, Math.ceil((ends - Date.now()) / 1000))}s`);
    show();
    cancelButton?.append(clock);
    say(`If you don't cancel UA 837, the airline will, in ${AUTO_CANCEL_MS / 1000} seconds.`);
    countdown = {
      conversationId,
      tick: setInterval(show, 1_000),
      due: setTimeout(() => {
        stopCountdown();
        const fire = () => {
          // only for the conversation it was started for, while nobody has
          // cancelled it: a new chat starts its own
          if (chat.state.conversationId !== conversationId || cancelling) return;
          // another of the airline's requests is still going: cancel once it's done
          if (busy) return void setTimeout(fire, 300);
          cancelling = true;
          void run(ACTIONS[0], `Nobody cancelled it, so after ${AUTO_CANCEL_MS / 1000} seconds the airline did. `);
        };
        fire();
      }, AUTO_CANCEL_MS),
    };
  };

  chat.subscribe((state, event) => {
    // A trip opens: the countdown starts. Its revision, or the cancellation
    // notice, means the flight is cancelled, whoever did it, or the flight
    // home is booked: either way, nothing is left to start. The trip card
    // shown again later, by show_bookings, starts nothing: the countdown
    // belongs to the trip that opened the conversation.
    if (event.type === "ui_open" && event.component === "trip_card" && !event.replaces) {
      if (state.conversationId && counted !== state.conversationId) startCountdown(state.conversationId);
    } else if ((event.type === "ui_open" && event.component === "trip_card") || (event.type === "notice" && event.name === "flight_cancelled")) {
      cancelling = true;
      stopCountdown();
    } else if (event.type === "ui_open" && event.component === "flight_search") {
      // The visitor is booking the flight home: the airline doesn't interrupt,
      // and that includes a cancellation already due, waiting on a busy
      // request to retry. Only a countdown still showing needs the word.
      const counting = countdown !== null;
      cancelling = true;
      stopCountdown();
      if (counting) say("You're booking the flight home, so the airline won't cancel UA 837 by itself. Press Cancel the flight whenever you like.");
    } else if (["reset", "closed"].includes(/** @type {{ type: string }} */ (event).type)) {
      // the chat's own events, not the server's: a new conversation, or none
      stopCountdown();
    }
  });

  bar.append(label, buttons, status);
  // Just under the header; at the top if a later mountChat draws no header.
  const top = root.querySelector(".hai-top");
  if (top) top.after(bar);
  else root.prepend(bar);
  return bar;
}
