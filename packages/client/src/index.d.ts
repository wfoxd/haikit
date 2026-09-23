/**
 * Types for the headless browser runtime.
 *
 * Hand-written rather than generated, and deliberately self-contained: this
 * package has no runtime dependencies and gains none by being typed. The wire
 * shapes below mirror `@haikit/core`'s `Block` / `WireEvent`, which is the one
 * thing crossing the server/browser line — on this side it crosses as types
 * only, so duplicating them here costs nothing at runtime.
 */

export type ConversationStatus = "idle" | "streaming" | "awaiting";
export type SurfaceMode = "display" | "elicit";
export type SurfaceState = "live" | "frozen";

/** Blocks the server emits, plus the two the client synthesises locally. */
export type Block =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string }
  | { kind: "tool"; id: string; name: string; input: unknown; status: string; ms?: number; result?: string }
  | { kind: "interaction"; id: string; handle: string; label: string }
  /** synthesised from `ui_open` — the slot a surface mounts into */
  | { kind: "ui"; id: string; handle: string; toolId: string }
  /** synthesised from `error` */
  | { kind: "error"; id: string; message: string };

/** The SSE frame shape. Narrow on `type` to get the specific payload. */
export type WireEvent = { type: string } & Record<string, any>;

/**
 * What `mount()` hands your component. `send` is the ONLY channel back to the
 * server: it carries an action name declared in the surface contract — never a
 * tool name, never a handler.
 */
export interface MountCtx {
  handle: string;
  mode: SurfaceMode;
  state: SurfaceState;
  send(action: string, value: unknown): Promise<void>;
}

/**
 * Returned by `mount`. `freeze` is called when the server marks the surface
 * frozen — a resolved elicit turn cannot be replayed, and the component should
 * reflect that.
 */
export interface SurfaceInstance {
  freeze?(selection?: unknown): void;
}

/** Your component. `props` is whatever the surface's `props` schema produces. */
export interface ComponentDef<P = any> {
  mount(element: HTMLElement, props: P, ctx: MountCtx): SurfaceInstance | null | void;
}

/**
 * The allowlist. A component the registry does not name cannot be mounted —
 * an unknown name renders an error card, never improvised UI.
 */
export type Registry = Record<string, ComponentDef<any>>;

export interface SurfaceRecord {
  handle: string;
  component: string;
  version: number;
  mode: SurfaceMode;
  state: SurfaceState;
  props: unknown | null;
  instance: SurfaceInstance | null;
}

export interface ChatState {
  conversationId: string | null;
  model: string;
  status: ConversationStatus;
  blocks: Block[];
  /** handle → surface record */
  surfaces: Map<string, SurfaceRecord>;
  context: { messages: any[]; modelTokens: number; uiTokens: number };
}

export interface Chat {
  /** Mutable — read it in a subscriber, do not hold references across events. */
  state: ChatState;
  send(text: string): Promise<void>;
  interact(handle: string, action: string, value: unknown): Promise<void>;
  /** Mounts the surface for `handle` into `element`. Null if props have not arrived. */
  mount(handle: string, element: HTMLElement): SurfaceInstance | null;
  /** Returns an unsubscribe function. */
  subscribe(fn: (state: ChatState, event: WireEvent) => void): () => void;
}

export function createChat(options: { endpoint?: string; registry: Registry }): Chat;
