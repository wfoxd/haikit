import { postcardDelivered, replyReceived } from "../shared/notices.ts";

// The server halves. `model` is required, as a surface's digest is: it is all
// the model ever hears of a notice.

export const postcardDeliveredServer = postcardDelivered.implement({
  model: (p) => `The postcard to ${p.to} was delivered: "${p.text}" (${p.language}). Reference ${p.reference}.`,
});

// A wake notice starts a turn, so its model text can't be null: the turn is
// the model's answer to it.
export const replyReceivedServer = replyReceived.implement({
  model: (p) => `${p.from} replied to the postcard, in ${p.language}: "${p.text}"`,
});
