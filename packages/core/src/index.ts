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
  /**
   * JSON Schema for this query's arguments, spliced into the derived `query_ui`
   * tool so the model can see the parameter names.
   *
   * Omit it and the model is shown an opaque `args: {}`. It will then call the
   * query with no arguments, every filter will be a no-op, and it will get the
   * whole collection back — the exact outcome `cap()` and the digest exist to
   * prevent. `input` cannot supply this: schemas are accepted structurally, so
   * the runtime has a `.parse()` and no way to introspect it.
   */
  argsJsonSchema?: JsonSchema;
}

export type ActionMap = Record<string, ActionSpec<ActionKind, any>>;
export type QueryMap = Record<string, QuerySpec<any>>;

/** Resolves a parked `elicit` turn. The click becomes the tool_result. */
export const resolve = <V>(input: Schema<V>): ActionSpec<"resolve", V> => ({ kind: "resolve", input });

/** Adds context to the conversation without having blocked it. */
export const inform = <V>(input: Schema<V>): ActionSpec<"inform", V> => ({ kind: "inform", input });

/** A named accessor over the stored payload. There is no raw dereference. */
export const query = <A>(
  input: Schema<A>,
  description?: string,
  argsJsonSchema?: JsonSchema,
): QuerySpec<A> => ({ input, description, argsJsonSchema });

// ──────────────────────────────────────────────────────── surfaces

export interface DigestCtx {
  handle: string;
}
export interface ActionCtx<P> {
  props: P;
  handle: string;
  readonly conversationId: string;
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

  /**
   * One handler per declared action. A click the turn cannot accept — a
   * `resolve` on a surface it isn't waiting for, or an `inform` while it waits
   * on one — is refused before its handler runs, so a handler may write, and
   * may be async. If it throws, the click is refused: nothing is recorded and
   * the surface stays live, so a handler that writes should undo its own
   * partial work.
   *
   * It runs at least once per recorded click, not exactly once. If saving the
   * click fails after the handler has run — the process crashes, or a newer
   * request takes the conversation over — nothing is recorded, and clicking
   * again runs it again, perhaps with a different value. A `resolve` is
   * recorded at most once per surface, so a `resolve` handler that writes
   * should upsert on `(conversationId, handle)`: handles are unique only
   * within a conversation, and the last attempt is the one recorded. An
   * `inform` surface takes any number of clicks, so that pair identifies none
   * of them; an `inform` handler that writes needs a write that is safe to
   * repeat, or a key of its own.
   */
  actions: {
    [K in keyof A]: (value: Infer<A[K]["input"]>, ctx: ActionCtx<P>) => string | Promise<string>;
  };

  /** GUARANTEE 2 — must return `Capped`, i.e. must call `ctx.cap`. */
  queries: { [K in keyof Q]: (args: Infer<Q[K]["input"]>, ctx: QueryCtx<P>) => Capped };

  /**
   * How long this surface's data may be acted on, in milliseconds from when it
   * was rendered, or `"never"` — the default — for data that does not go out of
   * date. Set it on any surface showing prices, availability or anything else
   * that changes: the default is right for greetings and wrong for fares.
   *
   * Once any surface in a conversation is past its window, the conversation is
   * closed: every further request — a click or a typed message — is refused
   * before the model runs, and the user is asked to start a new conversation.
   * Answered surfaces count too, because what the user picked from one is still
   * sitting in the model's context at the price it was shown at.
   *
   * The window is recorded with each payload as it renders, and a request is
   * held to the stricter of that and whatever the code declares by then. A
   * later deploy can tighten a window; renaming a surface, removing it or
   * relaxing its window never lets data already shown last longer.
   */
  staleAfterMs?: number | "never";
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

// ───────────────────────────────────────────────────────── notices

export interface NoticeImplDef<P> {
  /**
   * GUARANTEE 1, for notices — required. What the model hears of this notice,
   * or `null` for nothing.
   *
   * A notice has two halves, like a tool result: its payload goes to the
   * browser, and this goes to the model, in the next user message. Leaving the
   * model out has to be a decision, or the browser shows a change the model
   * goes on talking past. Precompute what the next turn needs, as a digest
   * does; the payload can be large, because only the browser receives it.
   *
   * Runs once, when the notice is sent, and the text is stored with it: a later
   * deploy that renames the notice or changes this cannot change what the model
   * hears of one already sent.
   */
  model: (payload: P) => string | null;
}

export interface Notice<P> {
  readonly name: string;
  readonly version: number;
  readonly payload: Schema<P>;
  implement(impl: NoticeImplDef<P>): NoticeImpl<P>;
}

export interface NoticeImpl<P> {
  readonly notice: Notice<P>;
  readonly impl: NoticeImplDef<P>;
}

export type AnyNoticeImpl = NoticeImpl<any>;

/**
 * Declare a notice: something the server tells a conversation outside of any
 * request, such as a booking confirmed by a webhook. Import this module from
 * BOTH halves, as with a surface: the server calls `.implement()` and sends it
 * with `hai.notify`, the browser renders its payload from the client's
 * `notices` registry.
 *
 * A notice cannot round-trip. Its component gets no `send`; one that needs a
 * button should show a surface instead.
 */
export function defineNotice<P>(def: { name: string; version: number; payload: Schema<P> }): Notice<P> {
  const notice: Notice<P> = {
    name: def.name,
    version: def.version,
    payload: def.payload,
    implement(impl) {
      return { notice, impl };
    },
  };
  return notice;
}

export interface NotifyOptions {
  /**
   * A surface the browser shows this notice beside: one from the
   * conversation's saved history, such as an action handler's `ctx.handle`.
   * It is checked against the stored surfaces, so one left behind by an
   * overtaken turn may pass too until a sweep removes it. No promise, just
   * harmless: the handle only places the notice, and the model never sees it.
   */
  handle?: string;
}

/**
 * Send a notice to a conversation. The payload is typed from the notice's
 * contract, and checked against its schema before it is stored. Resolves to the
 * notice's sequence number in that conversation.
 */
export type Notify = <P>(
  conversationId: string,
  notice: NoticeImpl<P>,
  payload: NoInfer<P>,
  options?: NotifyOptions,
) => Promise<{ seq: number }>;

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

/**
 * How far a running tool has got. Every field is optional, and a call updates
 * only the fields it names: say what is happening once, then count.
 */
export interface Progress {
  /** What the tool is doing now, for a person to read. */
  message?: string;
  /** Steps finished so far. */
  done?: number;
  /** Steps in all, when the tool knows: more than zero. With it, the browser draws a bar. */
  total?: number;
}

export interface ToolCtx {
  readonly conversationId: string;

  /** A tool with no UI. */
  text(model: string): ToolReturn;

  /**
   * Tell the browser how far this call has got. UI channel only: nothing is
   * stored, and the model never sees it. Frames go out at most every 100 ms,
   * and the last one always does. A call after the tool has returned does
   * nothing.
   */
  progress(progress: Progress): void;

  /**
   * Render a surface as a blocking question. Requires a `resolve` action.
   *
   * One per model reply, because the turn waits on one surface. Once a call
   * in the reply has asked, a second question is neither stored nor shown:
   * this resolves to a note telling the model so, with no `handle`.
   */
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
  /**
   * Every handle this conversation's surviving history rendered.
   *
   * Load-bearing, not bookkeeping: an interaction is refused unless its handle
   * appears here. A payload row alone is not proof, because a turn that was
   * overtaken leaves its rows behind while its conversation save is discarded.
   */
  handles: string[];
  /**
   * Handles whose elicit turn has been answered — resolved by a click, or closed
   * out by a typed override. An interaction on one of these is refused.
   *
   * This lives on the conversation, not on the payload, because freezing is half
   * of one transition: the other half is the history recording what the user
   * chose. Split across two rows, a turn could freeze the payload while it still
   * held the lease, lose the lease before saving, and leave the surviving history
   * awaiting a surface that can never be clicked again. On one fenced row the two
   * halves commit together or not at all.
   */
  frozen: string[];
  pending: Pending | null;
  /** Turn lease expiry. A dead process leaves this in the past. */
  leaseUntil: number | null;
  /**
   * Fencing token, reissued every time the lease is acquired.
   *
   * Expiry alone is not mutual exclusion. A request slower than the TTL loses
   * the lease while still running; another process takes it and saves a newer
   * turn; the first then finishes and writes its stale copy over the top. The
   * token is what lets `saveConversation` tell those two apart — a holder whose
   * token no longer matches the stored one has been superseded.
   */
  leaseToken: string | null;
  /**
   * The highest notice sequence number this conversation's history has taken
   * in: every notice up to it has reached the model (or said it had nothing
   * for it). Missing on conversations from before notices, which means 0.
   *
   * Lives on the fenced row for the reason `frozen` does. Taking a notice in
   * and the history recording its text are one transition: a turn whose save
   * is discarded leaves the notice untaken, and the turn that won takes it in.
   */
  noticedThrough?: number;
}

/**
 * A notice as stored: what `hai.notify` sent, numbered in its conversation.
 * Append-only — nothing about a notice changes once it is written.
 */
export interface NoticeRecord {
  conversationId: string;
  /**
   * Per conversation, strictly increasing, and in commit order: a reader that
   * has seen `seq` must never later find a smaller one appear. Gaps are fine.
   */
  seq: number;
  /** When it was written, in epoch milliseconds. */
  createdAt: number;
  /** The notice contract's name and version. */
  name: string;
  version: number;
  /** The payload, validated. Returned exactly as given. */
  payload: unknown;
  /**
   * What the model hears of it, computed when it was sent. Never on the events
   * stream. Once a turn takes it in, it is part of the history, and the
   * `context` event shows it to the browser's inspector, as it does digests.
   */
  model: string | null;
  /** A surface the browser shows it beside. */
  handle?: string;
}

/**
 * A rendered surface's data. **Immutable once written**: everything about a
 * surface that changes over the conversation lives on the fenced conversation
 * row instead (see `Conversation.frozen`), so no payload write can ever disagree
 * with the history that references it.
 */
export interface PayloadRecord {
  handle: string;
  conversationId: string;
  component: string;
  version: number;
  props: unknown;
  mode: "display" | "elicit";
  createdAt: number;
  /**
   * The surface's freshness window when this payload rendered — recorded, not
   * looked up later, because a later deploy may rename or remove the surface or
   * relax its window. `null` or absent only on payloads written before windows
   * existed, or by a store that does not keep it — both are held to the window
   * the code declares. A store should return exactly what it was given,
   * `"never"` included.
   */
  staleAfterMs?: number | "never" | null;
}

// ─────────────────────────────────────────────────── wire protocol

export type Block =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      input: unknown;
      status: string;
      ms?: number;
      result?: string;
      /** What `progress` events have said so far, merged. Set by the client. */
      progress?: Progress;
    }
  | { kind: "interaction"; id: string; handle: string; label: string };

export type WireEvent =
  | {
      type: "hello";
      conversationId: string;
      model: string;
      /** The server sends notices: open `GET {base}/events` for this conversation. */
      events?: true;
    }
  /**
   * A notice, on the events stream only. Its `model` half is not in it: that
   * goes to the model, in the next user message, and the browser sees it only
   * as part of the history, in the `context` event's inspector view.
   */
  | { type: "notice"; seq: number; name: string; version: number; payload: unknown; handle?: string }
  | { type: "block_start"; block: Block }
  | { type: "text_delta"; id: string; text: string }
  | { type: "block_update"; id: string; status: string; ms: number; result: string }
  /** A running tool's `ctx.progress`. Only the fields that call named are present. */
  | ({ type: "progress"; toolId: string } & Progress)
  | {
      type: "ui_open";
      handle: string;
      toolId: string;
      component: string;
      version: number;
      mode: string;
      /** The surface's freshness window. Absent when it never goes out of date. */
      staleAfterMs?: number;
    }
  | { type: "ui_props"; handle: string; props: unknown }
  | { type: "ui_state"; handle: string; state: "frozen"; selection?: unknown }
  | { type: "status"; status: ConversationStatus }
  | { type: "context"; messages: Message[]; modelTokens: number; uiTokens: number }
  | { type: "error"; message: string }
  /**
   * The conversation is past a surface's freshness window, so this request was
   * refused before the model ran and nothing was recorded. Final: every later
   * request on this conversation gets the same answer.
   */
  | { type: "expired"; message: string };

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

/**
 * Thrown by `loadConversation` when another request already holds the turn.
 *
 * Detected by `name` rather than `instanceof`: a duplicated install of this
 * package would give two distinct classes, and the check must not silently
 * start returning 500 for a case that is really a 409.
 */
export class ConversationBusy extends Error {
  readonly name = "ConversationBusy";
  constructor(id: string) {
    super(`conversation ${id} is busy — another turn is in flight`);
  }
}

export const isConversationBusy = (err: unknown): boolean =>
  err instanceof Error && err.name === "ConversationBusy";

/**
 * Thrown by `saveConversation` when the caller's lease was superseded while its
 * turn was still running. The write is rejected; the newer turn stands.
 */
export class StaleLease extends Error {
  readonly name = "StaleLease";
  constructor(id: string, detail = "was taken over by a newer turn — this write was discarded") {
    super(`conversation ${id} ${detail}`);
  }
}

export const isStaleLease = (err: unknown): boolean =>
  err instanceof Error && err.name === "StaleLease";

export interface StoreAdapter {
  /**
   * Load a conversation, creating one when `id` is undefined, and **acquire the
   * turn lease**.
   *
   * A conversation may have exactly one turn in flight. Without that, two
   * overlapping requests each load a copy, each mutate it, and the second
   * `saveConversation` silently discards the first turn's messages. An
   * in-process store hides this by handing back one shared object; anything
   * networked does not.
   *
   * The lease must be checked here rather than at save time: a conflict
   * discovered after the turn has run has already cost a model call.
   *
   * Throws `ConversationBusy` if a live lease is held. A lease older than its
   * TTL is expired and may be taken — that is what releases a conversation
   * stranded by a crashed process.
   *
   * **Acquisition must be atomic.** Reading the lease and then writing a new one
   * is two operations, and two instances can both read "expired" before either
   * writes — so both acquire, and the exclusion this method exists for is gone.
   * Express it as one conditional statement, not a read followed by an update:
   *
   * ```sql
   * UPDATE conversations
   *    SET lease_until = now() + $ttl, lease_token = gen_random_uuid()
   *  WHERE id = $1 AND (lease_until IS NULL OR lease_until < now())
   *  RETURNING *
   * ```
   *
   * No row returned means the lease was live. Note that no conformance test can
   * hold you to this: a single-process suite cannot interleave two acquisitions,
   * so a read-then-write implementation passes everything and still races in
   * production. It is a review item, not a testable one.
   */
  loadConversation(id: string | undefined): Promise<Conversation>;
  /**
   * Persist a conversation, **rejecting a holder that has been superseded**.
   *
   * Throws `StaleLease` when `conversation.leaseToken` no longer matches the
   * stored one. Without that check, expiry-based leasing still loses updates:
   * a request slower than the TTL is overtaken, and its final write clobbers the
   * turn that overtook it.
   *
   * The returned conversation must be independent of stored state. A store that
   * hands back a live reference cannot detect staleness at all, because the
   * caller's copy and the stored one are the same object.
   *
   * **The token check and the write must be one operation**, for the same reason
   * as acquisition. Read-the-token-then-update lets a takeover land in between:
   * the old holder sees its own token, the new holder writes, and the old update
   * then clobbers it. Compare-and-set in a single statement and treat zero rows
   * as stale:
   *
   * ```sql
   * UPDATE conversations SET messages = $3, ...
   *  WHERE id = $1 AND lease_token = $2
   * -- rowCount 0 → throw StaleLease
   * ```
   *
   * That statement also rejects two cases a read-then-write check tends to wave
   * through, and a store must reject them too: a conversation that does not
   * exist (there is no row to match), and a null token (`NULL = x` is never
   * true). Saving a conversation this store never issued a lease for is not an
   * upsert — every conversation begins at `loadConversation`.
   *
   * Like acquisition, atomicity is a review item: a single-process suite cannot
   * interleave the two halves to catch a read-then-write implementation.
   */
  saveConversation(conversation: Conversation): Promise<void>;
  /**
   * Store a payload and return its handle.
   *
   * Fenced: throws `StaleLease` unless `leaseToken` is the conversation's
   * current one. A superseded turn must stop writing rather than run to
   * completion and be discarded at the end. As with `saveConversation`, check
   * and insert in one statement:
   *
   * ```sql
   * INSERT INTO payloads (conversation_id, handle, ...)
   * SELECT $1, $2, ... WHERE EXISTS (
   *   SELECT 1 FROM conversations WHERE id = $1 AND lease_token = $3)
   * -- rowCount 0 → throw StaleLease
   * ```
   *
   * That shape rejects an unknown conversation and a null token for free, and a
   * store must too — otherwise a caller holding no lease at all can create rows
   * that no conversation owns.
   *
   * Every field comes back exactly as given — `staleAfterMs` included, as a
   * number or the string `"never"`. It is what holds data to the window it was
   * shown under after a deploy changes the surface.
   *
   * A row written *before* the lease was lost still outlives its turn — the
   * conversation save is rejected but the row is not, so the winning history
   * never references the handle. Those orphans are inert (see
   * `Conversation.handles`); a durable store sweeps them by `createdAt`.
   */
  putPayload(
    record: Omit<PayloadRecord, "handle" | "createdAt">,
    leaseToken: string | null,
  ): Promise<string>;
  getPayload(handle: string, conversationId: string): Promise<PayloadRecord | null>;
  /**
   * Batch form of `getPayload`, scoped the same way, and defined as exactly
   * that: the result is what calling `getPayload` once per input handle would
   * return, in input order, with the nulls dropped. Missing or out-of-scope
   * handles are omitted, so the result may be shorter than the input; a handle
   * listed twice appears twice. Stores must not "improve" on this by
   * deduplicating — two adapters that disagree here make any caller's count
   * depend on which store it runs against.
   *
   * Exists because the context inspector reads every live payload on every
   * turn. One call per handle is a map lookup in memory and a round trip over a
   * network, so the loop is O(surfaces) queries per turn against a real store.
   */
  getPayloads(handles: string[], conversationId: string): Promise<PayloadRecord[]>;

  /**
   * Append a notice and return it as stored, numbered and timestamped.
   *
   * **Unfenced**: it takes no lease token. A notice comes from outside any
   * turn — a webhook, a job queue — and must land while a turn is streaming or
   * parked, so it never touches the conversation's history; the turn that next
   * records a user message takes it in.
   *
   * Throws if the conversation does not exist. Every field comes back exactly
   * as given.
   *
   * **`seq` must be in commit order, not merely increasing.** A global
   * sequence lets one write take 10 and commit after another commits 11: a
   * reader at 11 then never sees 10. Number it per conversation under the
   * conversation's row lock, in the same statement as the insert:
   *
   * ```sql
   * WITH next AS (
   *   UPDATE conversations SET notice_seq = notice_seq + 1
   *    WHERE id = $1 RETURNING notice_seq)
   * INSERT INTO notices (conversation_id, seq, …)
   * SELECT $1, notice_seq, … FROM next RETURNING *
   * ```
   *
   * No row from `next` means no such conversation. Like the lease, a
   * single-process suite cannot hold a store to this; it is a review item.
   */
  putNotice(record: Omit<NoticeRecord, "seq" | "createdAt">): Promise<NoticeRecord>;
  /**
   * A conversation's notices with `seq > after`, in seq order, at most `limit`
   * of them. `null` means there is no such conversation; `[]` means none yet.
   */
  getNotices(conversationId: string, after: number, limit?: number): Promise<NoticeRecord[] | null>;
  /**
   * Optional. Resolves each step whenever a notice may have landed in this
   * conversation, until `signal` aborts. It carries nothing: the caller reads
   * with `getNotices`, so a wake-up that is lost or spurious delays a notice
   * but never loses or duplicates one. The events route reads every couple of
   * seconds regardless; this only makes a read sooner.
   */
  watch?(conversationId: string, signal: AbortSignal): AsyncIterable<void>;
}

/** Rough token estimate. Only used to surface the economics in the UI. */
export const estTokens = (value: unknown): number =>
  Math.ceil((typeof value === "string" ? value : JSON.stringify(value ?? "")).length / 4);
