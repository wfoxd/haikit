/**
 * hai-core — the contract layer.
 *
 * Isomorphic. Imported by the server runtime, by adapters, and (as types only)
 * by app code on both sides of the wire. Zero runtime dependencies: schemas are
 * accepted structurally, so zod works but is not required.
 *
 * Four guarantees are enforced here, in the type system:
 *   1. a surface cannot exist without a `digest`
 *   2. a query's return value can only be produced by `cap()`
 *   3. `mode: "elicit"` only accepts a surface declaring a `resolve` action
 *   4. declaring an action is the only way to make it round-trip
 */

// ───────────────────────────────────────────────────────── schemas

/** Structural match for zod, valibot, or a hand-rolled validator. */
export interface Schema<T> {
  parse(value: unknown): T;
}

export type Infer<S> = S extends Schema<infer T> ? T : never;

/** JSON Schema for the model-facing tool definition. */
export type JsonSchema = Record<string, unknown>;

// ───────────────────────────────────────────── GUARANTEE 2: Capped

declare const CAPPED: unique symbol;

/**
 * The return type of a query. There is no runtime value for CAPPED, so no
 * object literal can satisfy this — `cap()` is the only constructor.
 *
 * This is what stops a filter that matches all 47 rows from returning all 47.
 */
export interface Capped {
  readonly [CAPPED]: true;
  text: string;
  shown: number;
  total: number;
}

export interface CapOptions {
  /** Secondary bound. Default 8. */
  maxRows?: number;
  /** Primary bound — a token proxy. Whichever binds first wins. Default 1800. */
  maxChars?: number;
}

export type Cap = <T>(rows: T[], fmt: (row: T) => string, opts?: CapOptions) => Capped;

/**
 * Bound a result set and — just as important — say that you bounded it.
 * Silent truncation turns a cost problem into a correctness problem: the model
 * reports "there are 8" when there are 30, and it has no way to know better.
 */
export function makeCap(total: number): Cap {
  return function cap<T>(rows: T[], fmt: (row: T) => string, opts: CapOptions = {}): Capped {
    const maxRows = opts.maxRows ?? 8;
    const maxChars = opts.maxChars ?? 1800;

    const lines: string[] = [];
    let chars = 0;
    for (const row of rows.slice(0, maxRows)) {
      const line = fmt(row);
      if (chars + line.length > maxChars) break;
      lines.push(line);
      chars += line.length + 1;
    }

    const omitted = rows.length - lines.length;
    const head =
      rows.length === 0
        ? `0 of ${total} match.`
        : `${rows.length} of ${total} match. ${lines.length} shown` +
          (omitted > 0 ? `, ${omitted} omitted` : "") +
          ":";

    return {
      text: lines.length ? `${head}\n${lines.join("\n")}` : head,
      shown: lines.length,
      total,
    } as Capped;
  };
}

// ────────────────────────────────────────────── actions and queries

export type ActionKind = "resolve" | "inform";

export interface ActionSpec<K extends ActionKind = ActionKind, V = unknown> {
  kind: K;
  input: Schema<V>;
}

export interface QuerySpec<A = unknown> {
  input: Schema<A>;
  description?: string;
}

export type ActionMap = Record<string, ActionSpec<ActionKind, any>>;
export type QueryMap = Record<string, QuerySpec<any>>;

/** Resolves a parked `elicit` turn. The click becomes the tool_result. */
export const resolve = <V>(input: Schema<V>): ActionSpec<"resolve", V> => ({ kind: "resolve", input });

/** Adds context to the conversation without having blocked it. */
export const inform = <V>(input: Schema<V>): ActionSpec<"inform", V> => ({ kind: "inform", input });

/** A named accessor over the stored payload. There is no raw dereference. */
export const query = <A>(input: Schema<A>, description?: string): QuerySpec<A> => ({ input, description });

// ──────────────────────────────────────────────────────── surfaces

export interface DigestCtx {
  handle: string;
}
export interface ActionCtx<P> {
  props: P;
  handle: string;
}
export interface QueryCtx<P> {
  props: P;
  cap: Cap;
}

export interface SurfaceImplDef<P, A extends ActionMap, Q extends QueryMap> {
  /**
   * GUARANTEE 1 — required.
   *
   * A count and a price range is a lazy digest; it invites the model to narrate
   * facts about rows it never received. Precompute whatever the next turn or two
   * will plausibly need.
   */
  digest: (props: P, ctx: DigestCtx) => string;

  actions: { [K in keyof A]: (value: Infer<A[K]["input"]>, ctx: ActionCtx<P>) => string };

  /** GUARANTEE 2 — must return `Capped`, i.e. must call `ctx.cap`. */
  queries: { [K in keyof Q]: (args: Infer<Q[K]["input"]>, ctx: QueryCtx<P>) => Capped };
}

export interface Surface<P, A extends ActionMap, Q extends QueryMap> {
  readonly name: string;
  readonly version: number;
  readonly props: Schema<P>;
  readonly actions: A;
  readonly queries: Q;
  implement(impl: SurfaceImplDef<P, A, Q>): SurfaceImpl<P, A, Q>;
}

export interface SurfaceImpl<P, A extends ActionMap, Q extends QueryMap> {
  readonly surface: Surface<P, A, Q>;
  readonly impl: SurfaceImplDef<P, A, Q>;
}

export type AnySurfaceImpl = SurfaceImpl<any, ActionMap, QueryMap>;

/**
 * Declare a surface contract. Import this module from BOTH halves: the server
 * calls `.implement()`, the client renders against the same prop type.
 *
 * GUARANTEE 4: `actions` is the complete list of interactions that may reach the
 * server. Anything a component does that is not declared here is local by
 * construction — there is no channel for it.
 */
export function defineSurface<P, A extends ActionMap = {}, Q extends QueryMap = {}>(def: {
  name: string;
  version: number;
  props: Schema<P>;
  actions?: A;
  queries?: Q;
}): Surface<P, A, Q> {
  const surface: Surface<P, A, Q> = {
    name: def.name,
    version: def.version,
    props: def.props,
    actions: (def.actions ?? {}) as A,
    queries: (def.queries ?? {}) as Q,
    implement(impl) {
      return { surface, impl };
    },
  };
  return surface;
}

// ─────────────────────────────────────── GUARANTEE 3: elicit safety

type ResolveKeys<A extends ActionMap> = {
  [K in keyof A]: A[K]["kind"] extends "resolve" ? K : never;
}[keyof A];

export type HasResolve<A extends ActionMap> = [ResolveKeys<A>] extends [never] ? false : true;

/**
 * Passing a surface with no `resolve` action makes this an object type carrying
 * an unsatisfiable required property, so the error names the actual problem
 * instead of "not assignable to never".
 */
export type ElicitOptions<A extends ActionMap> = HasResolve<A> extends true
  ? { mode: "elicit" }
  : {
      mode: "elicit";
      "⚠ this surface declares no resolve action — an elicit turn could never be unparked": never;
    };

// ─────────────────────────────────────────────────────────── tools

export interface ToolReturn {
  /** Goes into `tool_result`. The model channel. */
  model: string;
  /** Set when the tool rendered a surface. */
  handle?: string;
}

export interface ToolCtx {
  readonly conversationId: string;

  /** A tool with no UI. */
  text(model: string): ToolReturn;

  /** Render a surface as a blocking question. Requires a `resolve` action. */
  render<P, A extends ActionMap, Q extends QueryMap>(
    surface: SurfaceImpl<P, A, Q>,
    props: P,
    options: ElicitOptions<A>,
  ): Promise<ToolReturn>;

  /** Render a surface as a side-artifact. Resolves immediately. */
  render<P, A extends ActionMap, Q extends QueryMap>(
    surface: SurfaceImpl<P, A, Q>,
    props: P,
    options?: { mode?: "display" },
  ): Promise<ToolReturn>;
}

export interface Tool<I = any> {
  readonly name: string;
  readonly description: string;
  readonly input: Schema<I>;
  readonly inputJsonSchema: JsonSchema;
  readonly strict: boolean;
  run(input: I, ctx: ToolCtx): Promise<ToolReturn> | ToolReturn;
}

export function defineTool<I>(def: {
  name: string;
  description: string;
  input: Schema<I>;
  /** JSON Schema sent to the model. Derive it with zod-to-json-schema if you like. */
  inputJsonSchema: JsonSchema;
  strict?: boolean;
  run(input: I, ctx: ToolCtx): Promise<ToolReturn> | ToolReturn;
}): Tool<I> {
  return { strict: true, ...def };
}

// ───────────────────────────────────────────────────── conversation

export type ConversationStatus = "idle" | "streaming" | "awaiting";

/** Anthropic-shaped message. Kept loose so adapters can map as needed. */
export interface Message {
  role: "user" | "assistant";
  content: unknown;
}

export interface Pending {
  toolUseId: string;
  handle: string;
  /** An elicit tool never received a tool_result, so its digest has not reached
   *  the model yet. It ships with the resolution. */
  digest: string;
  /** Sibling results from the same turn. The API is all-or-nothing per batch. */
  results: unknown[];
}

export interface Conversation {
  id: string;
  status: ConversationStatus;
  messages: Message[];
  handles: string[];
  pending: Pending | null;
  /** Turn lease. A dead process leaves this in the past. */
  leaseUntil: number | null;
}

export interface PayloadRecord {
  handle: string;
  conversationId: string;
  component: string;
  version: number;
  props: unknown;
  mode: "display" | "elicit";
  state: "live" | "frozen";
  createdAt: number;
}

// ─────────────────────────────────────────────────── wire protocol

export type Block =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string }
  | { kind: "tool"; id: string; name: string; input: unknown; status: string; ms?: number; result?: string }
  | { kind: "interaction"; id: string; handle: string; label: string };

export type WireEvent =
  | { type: "hello"; conversationId: string; model: string }
  | { type: "block_start"; block: Block }
  | { type: "text_delta"; id: string; text: string }
  | { type: "block_update"; id: string; status: string; ms: number; result: string }
  | { type: "ui_open"; handle: string; toolId: string; component: string; version: number; mode: string }
  | { type: "ui_props"; handle: string; props: unknown }
  | { type: "ui_state"; handle: string; state: "frozen"; selection?: unknown }
  | { type: "status"; status: ConversationStatus }
  | { type: "context"; messages: Message[]; modelTokens: number; uiTokens: number }
  | { type: "error"; message: string };

export type Emit = (event: WireEvent) => void;

// ───────────────────────────────────────────────────────── adapters

export interface ModelRequest {
  system: string;
  tools: { name: string; description: string; input_schema: JsonSchema; strict?: boolean }[];
  messages: Message[];
  onTextDelta: (text: string) => void;
}

export interface ModelResponse {
  content: any[];
  stop_reason: string;
}

export interface ModelAdapter {
  readonly id: string;
  generate(request: ModelRequest): Promise<ModelResponse>;
}

export interface StoreAdapter {
  loadConversation(id: string | undefined): Promise<Conversation>;
  saveConversation(conversation: Conversation): Promise<void>;
  putPayload(record: Omit<PayloadRecord, "handle" | "createdAt">): Promise<string>;
  getPayload(handle: string, conversationId: string): Promise<PayloadRecord | null>;
  freezePayload(handle: string): Promise<void>;
}

/** Rough token estimate. Only used to surface the economics in the UI. */
export const estTokens = (value: unknown): number =>
  Math.ceil((typeof value === "string" ? value : JSON.stringify(value ?? "")).length / 4);
