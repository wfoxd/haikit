import { defineNotice } from "@haikit/core";
import { z } from "zod";

// What the server can tell a conversation after its request is over. Like the
// surfaces, this module crosses the boundary: the server implements and sends
// these, the browser renders them.

/** The postcard reached the pen pal. A passive notice: it waits for the user. */
export const postcardDelivered = defineNotice({
  name: "postcard_delivered",
  version: 1,
  payload: z.object({
    to: z.string(),
    language: z.string(),
    text: z.string(),
    reference: z.string(),
  }),
});

/** The pen pal wrote back. A wake notice: the model hears it at once and tells the user. */
export const replyReceived = defineNotice({
  name: "reply_received",
  version: 1,
  kind: "wake",
  payload: z.object({
    from: z.string(),
    language: z.string(),
    text: z.string(),
  }),
});
