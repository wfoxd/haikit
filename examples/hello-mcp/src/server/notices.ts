import { accountConnected } from "../shared/notices.ts";
import { ACCOUNTS } from "../shared/surfaces.ts";

// A wake notice starts a turn, so its model text can't be null: the turn is
// the model's answer to it. It names the account, and nothing Notes said.
export const accountConnectedServer = accountConnected.implement({
  model: (p) => `The user connected ${ACCOUNTS[p.server] ?? p.server}.`,
});
