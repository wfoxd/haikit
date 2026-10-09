/**
 * Server halves of the notice contracts. `model` is required, as a surface's
 * digest is: it is all the model ever hears of a notice.
 */

import { holdConfirmed } from "../shared/notices.ts";

export const holdConfirmedServer = holdConfirmed.implement({
  model: (p) =>
    `${p.airline} confirmed the fare hold on ${p.flightId} (${p.date}, departs ${p.depart}, $${p.price}). ` +
    `Reference ${p.reference}.`,
});
