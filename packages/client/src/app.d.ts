import type { Chat, NoticeRegistry, Registry, SignalRegistry } from "./index.js";

export interface MountChatOptions {
  root: HTMLElement;
  registry: Registry;
  /** Components for the notices the server sends, by notice name. */
  notices?: NoticeRegistry;
  /** Handlers for the signals the server sends, by signal name. */
  signals?: SignalRegistry;
  /** Where the server's routes are: `nodeHandler`'s base path. Default `/hai`. */
  endpoint?: string;
  title?: string;
  subtitle?: string;
  /** Clickable starter prompts shown on the empty transcript. */
  suggestions?: string[];
  /**
   * Include the model context debug drawer, opened from the header. Default
   * true — keep it while developing. It starts closed, and opens again after a
   * reload if it was open before.
   */
  inspector?: boolean;
  placeholder?: string;
  emptyText?: string;
  /**
   * Pin the page to a colour scheme, by setting `data-hai-theme` on the root
   * element until the chat closes. Unset, it follows the system's light or
   * dark setting, or a `data-hai-theme` already in the page's markup.
   */
  theme?: "light" | "dark";
  /**
   * Let the reader dock surfaces. Default true. Each surface gets a bar with
   * its name and a Dock button, which moves it out of the transcript onto a
   * shelf above the message box; from there it opens as a window, one at a
   * time, and Put back or Remove from dock returns it to its place. `false`
   * shows surfaces as `renderTranscript` does without `onDock`.
   */
  dock?: boolean;
  /** Passed to `createChat`: how long the events stream may be silent before the chat polls. Default 8000 ms. */
  eventsFallbackMs?: number;
  /** Passed to `createChat`: how long each poll asks the server to hold. Default 15000 ms. */
  pollHoldMs?: number;
  /** Passed to `createChat`: what every request goes through. Default the page's `fetch`. */
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
  /**
   * Where to sign in. While the server turns the chat away as not signed in or
   * not allowed (`state.unauthorized`), the status line says why, followed by
   * a link here, labelled `label` (default "Sign in"). Without it, only why.
   */
  signIn?: { href: string; label?: string };
}

/**
 * Builds the shell, wires the composer, renders the transcript and mounts your
 * surfaces. The ten-line path to a running app. It starts the conversation as
 * soon as it opens, and again after `reset()`, so a server with an init tool
 * runs it before the user types.
 *
 * Returns the chat. `chat.close()` ends it for good and removes the shell, so a
 * page that takes the chat away again leaves nothing of it behind.
 *
 * It is a convenience, not the API — everything it does is built on `createChat`
 * and `renderTranscript`. Dropping to those when this shell stops fitting is the
 * expected path, not a failure mode.
 */
export function mountChat(options: MountChatOptions): Chat;

/** What the model context debug drawer shows: makes the dual channel visible. */
export function renderInspector(
  el: HTMLElement,
  context?: { messages?: any[]; modelTokens?: number; uiTokens?: number },
): void;
