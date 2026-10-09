/**
 * Server halves of the notice contracts. `model` is required, as a surface's
 * digest is: it is all the model ever hears of a notice.
 */

import { fareDropped, holdConfirmed } from "../shared/notices.ts";

export const holdConfirmedServer = holdConfirmed.implement({
  model: (p) =>
    `${p.airline} confirmed the fare hold on ${p.flightId} (${p.date}, departs ${p.depart}, $${p.price}). ` +
    `Reference ${p.reference}.`,
});

// A wake notice: model() must return text, since the turn it starts is the
// model's answer to it.
export const fareDroppedServer = fareDropped.implement({
  model: (p) =>
    `${p.airline} dropped the held fare on ${p.flightId} from $${p.was} to $${p.now}, ` +
    `saving $${p.was - p.now}. The hold now has the new fare.`,
});
