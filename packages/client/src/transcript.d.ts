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
 * The default transcript renderer. Replaces `root`'s children on every call and
 * preserves scroll-to-bottom. Deliberately plain — this is the part you are
 * expected to replace.
 */
export function renderTranscript(root: HTMLElement, chat: Chat): void;
