import type { Chat } from "./index.js";

/**
 * Element helper. Generic over the tag so `h("textarea", …).rows` and
 * `h("button", …).disabled` typecheck — a plain `HTMLElement` return would
 * force a cast at every call site.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string | null,
  text?: string | null,
): HTMLElementTagNameMap[K];

/**
 * The default transcript renderer. Call it on every event: a block keeps its
 * element while what it shows is unchanged, so each surface mounts once and
 * keeps its own state. While the reader is at the bottom, it keeps the newest
 * content in view, surfaces included once they have mounted and as they grow.
 * Once the reader scrolls up, it keeps their place until they scroll back
 * down. Deliberately plain — this is the part you are expected to replace.
 */
export function renderTranscript(root: HTMLElement, chat: Chat): void;

/**
 * Stop following a transcript that is going away, so its resize observer and
 * scroll listener let go of it. `mountChat` does this when its chat closes.
 */
export function closeTranscript(root: HTMLElement): void;
