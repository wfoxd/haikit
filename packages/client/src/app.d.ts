import type { Chat, Registry } from "./index.js";

export interface MountChatOptions {
  root: HTMLElement;
  registry: Registry;
  /** Base path the server's two routes are mounted at. Default `/hai`. */
  endpoint?: string;
  title?: string;
  subtitle?: string;
  /** Clickable starter prompts shown on the empty transcript. */
  suggestions?: string[];
  /** Show the context inspector. Default true — keep it on while developing. */
  inspector?: boolean;
  placeholder?: string;
  emptyText?: string;
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

/** The context inspector: makes the dual channel visible. */
export function renderInspector(
  el: HTMLElement,
  context?: { messages?: any[]; modelTokens?: number; uiTokens?: number },
): void;
