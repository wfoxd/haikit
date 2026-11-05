import { defineNotice } from "@haikit/core";
import { z } from "zod";

/**
 * The user connected an account, from a connect card in this conversation.
 * A wake notice: the model hears it at once, and calls the tool that needed
 * the account again.
 */
export const accountConnected = defineNotice({
  name: "account_connected",
  version: 1,
  kind: "wake",
  payload: z.object({ server: z.string() }),
});
