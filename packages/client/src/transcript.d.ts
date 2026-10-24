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

/** A surface whose Dock button was pressed, as `renderTranscript` hands it to `onDock`. */
export interface DockRequest {
  /** The surface's handle, as it is now. */
  handle: string;
  /** Its card, `div.hai-dockable`: stays in the transcript, in the surface's place. */
  card: HTMLElement;
  /** The element the surface is mounted in, `div.hai-surface`, inside the card. */
  element: HTMLElement;
}

export interface TranscriptOptions {
  /**
   * Makes surfaces dockable. Each one is drawn in a card, `div.hai-dockable`:
   * a bar with its component's name and, once mounted, a Dock button that
   * calls this. Moving `element` elsewhere keeps its component mounted; the
   * transcript leaves the card's contents to you. `mountChat` passes its dock.
   */
  onDock?: (request: DockRequest) => void;
}

/**
 * The default transcript renderer. Call it on every event: a block keeps its
 * element while what it shows is unchanged, so each surface mounts once and
 * keeps its own state. While the reader is at the bottom, it keeps the newest
 * content in view, surfaces included once they have mounted and as they grow.
 * Once the reader scrolls up, it keeps their place until they scroll back
 * down. Deliberately plain — this is the part you are expected to replace.
 */
export function renderTranscript(root: HTMLElement, chat: Chat, options?: TranscriptOptions): void;

/**
 * Stop following a transcript that is going away, so its resize observer and
 * scroll listener let go of it. `mountChat` does this when its chat closes.
 */
export function closeTranscript(root: HTMLElement): void;
