import type { Notify } from "@haikit/core";
import type { Greeting } from "../shared/surfaces.ts";
import { postcardDeliveredServer, replyReceivedServer } from "./notices.ts";

// Stands in for a postal service with a webhook. Posting a card returns at
// once; delivery, and the pen pal's reply, arrive later, long after the
// request that posted it has finished.

const PEN_PAL = "Sam";
const DELIVERY_MS = 2_000;
const REPLY_MS = 5_000;
const THANKS: Record<string, string> = {
  en: "Thank you, lovely to hear from you!",
  zh: "谢谢你的明信片！",
  es: "¡Muchas gracias por la postal!",
  ar: "شكراً على البطاقة!",
  ja: "はがきをありがとう！",
  he: "תודה על הגלויה!",
};

let notify: Notify | null = null;

/** Called once at startup with `hai.notify`. */
export function connectPostOffice(send: Notify) {
  notify = send;
}

/** Post `greeting` to the pen pal. Delivery is confirmed beside `handle`, and the reply follows. */
export function sendPostcard(conversationId: string, handle: string, greeting: Greeting) {
  const reference = `PC-${Math.floor(1000 + Math.random() * 9000)}`;
  setTimeout(() => {
    notify?.(
      conversationId,
      postcardDeliveredServer,
      { to: PEN_PAL, language: greeting.language, text: greeting.text, reference },
      { handle },
    ).catch((err) => console.error(`delivery for ${conversationId} not sent: ${err.message}`));
  }, DELIVERY_MS);
  setTimeout(() => {
    notify?.(
      conversationId,
      replyReceivedServer,
      { from: PEN_PAL, language: greeting.language, text: THANKS[greeting.code] ?? "Thank you!" },
      { handle },
    ).catch((err) => console.error(`reply for ${conversationId} not sent: ${err.message}`));
  }, REPLY_MS);
  return { to: PEN_PAL, reference };
}
