/**
 * The Airline ops panel: a bar under the header that plays the airline.
 *
 * It isn't part of the conversation. Its buttons call the demo server's
 * /ops routes, which act on this conversation the way an airline's systems
 * would: a notice for news, a revision for what's already on screen. So you
 * watch the outside world act, then the AI respond.
 */

/** @typedef {import("@haikit/client").Chat} Chat */

/** What each button asks the airline to do. */
const ACTIONS = [
  { route: "cancel", label: "Cancel the flight", hint: "The airline cancels UA 837. The guide hears of it and speaks first." },
  { route: "release", label: "Release the holds", hint: "The 5-minute seat holds run out now: seats left fall, and one option sells out." },
  { route: "gate", label: "Change the gate", hint: "The new flight's gate moves. The boarding pass is revised, and the guide speaks up." },
];

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

  let busy = false;
  for (const action of ACTIONS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ops-button";
    b.textContent = action.label;
    b.title = action.hint;
    b.onclick = async () => {
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
        status.textContent = body.message ?? `The airline answered ${res.status}.`;
        status.classList.toggle("is-refused", !res.ok);
      } catch {
        status.textContent = "The airline couldn't be reached.";
        status.classList.add("is-refused");
      } finally {
        busy = false;
        bar.classList.remove("is-busy");
      }
    };
    buttons.append(b);
  }

  bar.append(label, buttons, status);
  // Just under the header; at the top if a later mountChat draws no header.
  const top = root.querySelector(".hai-top");
  if (top) top.after(bar);
  else root.prepend(bar);
  return bar;
}
