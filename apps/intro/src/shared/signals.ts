import { defineSignal } from "@haikit/core";
import { z } from "zod";

/**
 * How many people have the introduction open right now: the count in the
 * header. A signal, not a notice: it belongs to no conversation, nobody needs
 * an old one, and the guide never hears it.
 */
export const online = defineSignal({
  name: "online",
  version: 1,
  payload: z.object({ count: z.number().int().nonnegative() }),
});
