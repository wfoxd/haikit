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

/** Blocks the server emits, plus the three the client synthesises locally. */
export type Block =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string }
  | { kind: "tool"; id: string; name: string; input: unknown; status: string; ms?: number; result?: string }
  | { kind: "interaction"; id: string; handle: string; label: string }
  /** synthesised from `ui_open` — the slot a surface mounts into */
  | { kind: "ui"; id: string; handle: string; toolId: string }
  /** synthesised from `error` */
  | { kind: "error"; id: string; message: string }
  /** synthesised from `expired` — the conversation is closed; offer `reset()` */
  | { kind: "expired"; id: string; message: string };

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
 *
 * `expire` is called when the conversation goes out of date. By then the
 * runtime has already made the element `inert` and set `data-expired` on it,
 * so nothing inside can reach the server; this hook is only for looks.
 */
export interface SurfaceInstance {
  freeze?(selection?: unknown): void;
  expire?(): void;
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
  /** The element it was last mounted into. */
  element: HTMLElement | null;
}

export interface ChatState {
  conversationId: string | null;
  model: string;
  status: ConversationStatus;
  blocks: Block[];
  /** handle → surface record */
  surfaces: Map<string, SurfaceRecord>;
  context: { messages: any[]; modelTokens: number; uiTokens: number };
  /**
   * When this conversation goes out of date, in this browser's clock (epoch
   * ms): the earliest freshness window among its surfaces, each counted from
   * when the request that rendered it was sent — so never later than the
   * server's own deadline. Null while nothing it shows can go stale.
   */
  expiresAt: number | null;
  /**
   * The notice to show once the conversation is out of date, else null. From
   * then on `send` and `interact` do nothing — the server would refuse them —
   * until `reset()` starts a new conversation.
   */
  expired: string | null;
}

export interface Chat {
  /** Mutable — read it in a subscriber, do not hold references across events. */
  state: ChatState;
  /**
   * Queue a message. Resolves `true` once the server has taken it, `false` if
   * it never did: the conversation went out of date first (at the call, or
   * while it waited behind a long turn), `reset()` started a new conversation
   * before its turn, or the server was still busy after one retry. A UI that
   * cleared its input can then put the text back.
   */
  send(text: string): Promise<boolean>;
  /**
   * Start the conversation before the user types, so a server with an init
   * tool runs it now and anything it shows is already there. Does nothing once
   * this chat has a conversation, and a server without an init tool creates
   * nothing. `mountChat` calls it when it opens and after `reset()`.
   */
  start(): Promise<boolean>;
  interact(handle: string, action: string, value: unknown): Promise<void>;
  /** Mounts the surface for `handle` into `element`. Null if props have not arrived. */
  mount(handle: string, element: HTMLElement): SurfaceInstance | null;
  /**
   * Start a new conversation on the next send. Anything queued for the old one
   * is never sent, and a request still open is aborted — the new conversation
   * never waits behind it. Subscribers are notified with `{ type: "reset" }`.
   */
  reset(): void;
  /** Returns an unsubscribe function. */
  subscribe(fn: (state: ChatState, event: WireEvent) => void): () => void;
}

export function createChat(options: { endpoint?: string; registry: Registry }): Chat;
