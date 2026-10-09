import type { Chat, NoticeRegistry, Registry } from "./index.js";

export interface MountChatOptions {
  root: HTMLElement;
  registry: Registry;
  /** Components for the notices the server sends, by notice name. */
  notices?: NoticeRegistry;
  /** Base path the server's two routes are mounted at. Default `/hai`. */
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
