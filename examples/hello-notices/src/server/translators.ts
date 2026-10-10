import type { Update } from "@haikit/core";
import type { Greeting } from "../shared/surfaces.ts";
import { greetingPickerServer } from "./surfaces.ts";

// Stands in for a team of translators. A little after a picker is shown, they
// add a language to it, and the picker on screen is revised in place.

const ADDED: Greeting = { code: "cy", language: "Welsh", text: "Helo, Fyd!", script: "Latin", rtl: false, speakersM: 0.9 };
const TRANSLATE_MS = 6_000;

let update: Update | null = null;

/** Called once at startup with `hai.update`. */
export function connectTranslators(revise: Update) {
  update = revise;
}

/** A little after the picker `handle` is shown, add a language to it. */
export function addTranslationSoon(conversationId: string, handle: string, greetings: Greeting[]) {
  setTimeout(() => {
    update?.(conversationId, greetingPickerServer, handle, { greetings: [...greetings, ADDED] }, {
      model: `Translators added ${ADDED.language}.`,
    }).catch((err) => {
      // once the user has picked, the picker is answered and can't change
      if (!/was answered/.test(err.message)) console.error(`translation for ${conversationId} not sent: ${err.message}`);
    });
  }, TRANSLATE_MS);
}
