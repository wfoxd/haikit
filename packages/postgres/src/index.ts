/**
 * @haikit/postgres — a durable StoreAdapter.
 *
 * Every method is a single SQL statement, and every fenced write checks the
 * lease token *inside* that statement. That is the whole trick: the contract in
 * `@haikit/core` requires the check and the write to be atomic, and a
 * conditional UPDATE is atomic without a transaction. There is no
 * read-then-write anywhere in this file, and none should be added.
 *
 * Time comes from the database (`now()`), never from `Date.now()`, so lease
 * expiry cannot be skewed by clocks on different app servers.
 */

import {
  ConversationBusy,
  StaleLease,
  type Conversation,
  type NoticeRecord,
  type PayloadRecord,
  type StoreAdapter,
} from "@haikit/core";

/**
 * Anything that runs a parameterised statement and returns rows. A `pg.Pool`,
 * a `pg.Client` and PGlite all satisfy this as they are — the driver is yours,
 * and so are pooling and connection lifecycle.
 *
 * Only `rows` is required. Every fenced statement here uses `RETURNING` and
 * checks the rows it got back rather than a driver's affected-row count,
 * because drivers disagree on what that field is called.
 */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

export interface PgStoreOptions {
  /**
   * Turn lease TTL. A process that dies mid-turn strands its conversation for
   * this long; too short and a slow turn is overtaken while still running —
   * which is safe (its writes are fenced out) but wasteful.
   */
  leaseMs?: number;
  /**
   * A connection that can `LISTEN`, so the events route hears of a notice the
   * moment it lands, rather than at its next read a couple of seconds on. It needs a
   * connection of its own: a pooled one goes back to the pool and stops
   * listening. PGlite's `listen` fits as it is; see the README for `pg`.
   */
  listen?: Listener;
}

/**
 * Something that can `LISTEN` on a channel and report each `NOTIFY` payload.
 * Resolves once listening, to a function that stops.
 */
export interface Listener {
  listen(channel: string, onNotify: (payload: string) => void): Promise<unknown>;
}

const LEASE_MS = 120_000;

/** The channel `putNotice` notifies on, with the conversation id as payload. */
export const NOTICE_CHANNEL = "haikit_notices";

/** The channel `publish` carries messages on, in pieces small enough for NOTIFY. */
export const TURN_CHANNEL = "haikit_turns";

/**
 * The most of a message one NOTIFY carries. Postgres refuses payloads of 8000
 * bytes or more; a piece is ASCII, so this leaves room for its header.
 */
const PIECE = 7_000;

/** How long half a message waits for the rest before it is given up on. */
const PIECE_TIMEOUT_MS = 30_000;

/** The most pieces one message may claim to have: about 52 MB of message, far past any frame. */
const MAX_PIECES = 10_000;

/** The longest message `publish` takes, in UTF-8 bytes: what MAX_PIECES pieces of base64 hold. */
export const MAX_PUBLISH_BYTES = Math.floor((PIECE * MAX_PIECES * 3) / 4);

/**
 * The schema, one statement per entry. `migrate()` runs these; export them to
 * your own migration tool instead if you have one.
 */
export const schema: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS haikit_conversations (
     id           text PRIMARY KEY,
     status       text NOT NULL,
     messages     jsonb NOT NULL DEFAULT '[]',
     handles      jsonb NOT NULL DEFAULT '[]',
     frozen       jsonb NOT NULL DEFAULT '[]',
     pending      jsonb,
     lease_until  timestamptz,
     lease_token  text,
     handle_seq   integer NOT NULL DEFAULT 0,
     -- the last notice number given out, and the last one its history took in
     notice_seq      integer NOT NULL DEFAULT 0,
     noticed_through integer NOT NULL DEFAULT 0,
     -- when recent wake turns started, and the last notice that may no longer start one
     wakes           jsonb NOT NULL DEFAULT '[]',
     woke_through    integer NOT NULL DEFAULT 0,
     -- how many wake turns it has started, to tell an older turn's frames from a newer's
     wake_turns      integer NOT NULL DEFAULT 0,
     -- surfaces revised in place: superseded handle → its replacement
     superseded      jsonb NOT NULL DEFAULT '{}',
     updated_at   timestamptz NOT NULL DEFAULT now()
   )`,
  // a table created before notices existed gains the columns
  `ALTER TABLE haikit_conversations ADD COLUMN IF NOT EXISTS notice_seq integer NOT NULL DEFAULT 0`,
  `ALTER TABLE haikit_conversations ADD COLUMN IF NOT EXISTS noticed_through integer NOT NULL DEFAULT 0`,
  `ALTER TABLE haikit_conversations ADD COLUMN IF NOT EXISTS wakes jsonb NOT NULL DEFAULT '[]'`,
  `ALTER TABLE haikit_conversations ADD COLUMN IF NOT EXISTS woke_through integer NOT NULL DEFAULT 0`,
  `ALTER TABLE haikit_conversations ADD COLUMN IF NOT EXISTS wake_turns integer NOT NULL DEFAULT 0`,
  `ALTER TABLE haikit_conversations ADD COLUMN IF NOT EXISTS superseded jsonb NOT NULL DEFAULT '{}'`,
  // Append-only, and never an orphan: a notice belongs to a conversation that
  // exists, and goes when it does.
  `CREATE TABLE IF NOT EXISTS haikit_notices (
     conversation_id text NOT NULL REFERENCES haikit_conversations(id) ON DELETE CASCADE,
     seq             integer NOT NULL,
     created_at      timestamptz NOT NULL DEFAULT now(),
     name            text NOT NULL,
     version         integer NOT NULL,
     payload         jsonb NOT NULL,
     model           text,
     handle          text,
     -- 'wake', or NULL for a passive notice
     kind            text,
     -- on an update notice, the surface its handle replaced
     replaces        text,
     PRIMARY KEY (conversation_id, seq)
   )`,
  `ALTER TABLE haikit_notices ADD COLUMN IF NOT EXISTS kind text`,
  `ALTER TABLE haikit_notices ADD COLUMN IF NOT EXISTS replaces text`,
  // Write-once. Nothing about a payload changes after insert — everything that
  // does lives on the fenced conversation row (see Conversation.frozen).
  `CREATE TABLE IF NOT EXISTS haikit_payloads (
     conversation_id text NOT NULL REFERENCES haikit_conversations(id) ON DELETE CASCADE,
     handle          text NOT NULL,
     component       text NOT NULL,
     version         integer NOT NULL,
     props           jsonb NOT NULL,
     mode            text NOT NULL,
     -- the lease the writing turn held. Only a newer token proves that turn can
     -- never save again, which is what makes an unreferenced row an orphan.
     lease_token     text NOT NULL,
     created_at      timestamptz NOT NULL DEFAULT now(),
     -- the surface's freshness window when this rendered, in ms; 'Infinity' is
     -- "never", NULL a payload written before windows existed
     stale_after_ms  double precision,
     PRIMARY KEY (conversation_id, handle)
   )`,
  // a table created before freshness windows existed gains the column; its
  // rows read as unknown and are held to whatever the code declares
  `ALTER TABLE haikit_payloads ADD COLUMN IF NOT EXISTS stale_after_ms double precision`,
  `CREATE INDEX IF NOT EXISTS haikit_payloads_created_at ON haikit_payloads (created_at)`,
];

/** Create the tables if they do not exist, and bring existing ones up to date. Idempotent. */
export async function migrate(db: Queryable): Promise<void> {
  // One statement per call: some drivers (PGlite among them) reject several
  // statements in a single parameterised query.
  for (const statement of schema) await db.query(statement);
}

// jsonb is always read as text and parsed here. Drivers disagree on whether
// they parse jsonb themselves, and guessing from the result's type cannot work:
// a jsonb string scalar parsed by the driver is a JS string too, and parsing it
// a second time throws. Taking text every time removes the guess.
const CONVERSATION_COLUMNS = `
  id, status, messages::text AS messages, handles::text AS handles,
  frozen::text AS frozen, pending::text AS pending, lease_token, noticed_through,
  wakes::text AS wakes, woke_through, wake_turns, superseded::text AS superseded,
  (extract(epoch FROM lease_until) * 1000)::float8 AS lease_until_ms`;

const NOTICE_COLUMNS = `
  conversation_id, seq, name, version, payload::text AS payload, model, handle, kind, replaces,
  (extract(epoch FROM created_at) * 1000)::float8 AS created_at_ms`;

// The window is read as text too: 'Infinity' is how "never" is stored, and
// drivers need not agree on turning it into a number.
const PAYLOAD_COLUMNS = `
  handle, conversation_id, component, version, props::text AS props, mode,
  (extract(epoch FROM created_at) * 1000)::float8 AS created_at_ms,
  stale_after_ms::text AS stale_after_ms`;

const json = (text: string) => JSON.parse(text);

const toConversation = (row: any): Conversation => ({
  id: row.id,
  status: row.status,
  messages: json(row.messages),
  handles: json(row.handles),
  frozen: json(row.frozen),
  pending: row.pending == null ? null : json(row.pending),
  leaseUntil: row.lease_until_ms == null ? null : Number(row.lease_until_ms),
  leaseToken: row.lease_token,
  noticedThrough: Number(row.noticed_through ?? 0),
  wakes: row.wakes == null ? [] : json(row.wakes),
  wokeThrough: Number(row.woke_through ?? 0),
  wakeTurns: Number(row.wake_turns ?? 0),
  superseded: row.superseded == null ? {} : json(row.superseded),
});

const toNotice = (row: any): NoticeRecord => ({
  conversationId: row.conversation_id,
  seq: Number(row.seq),
  createdAt: Number(row.created_at_ms),
  name: row.name,
  version: Number(row.version),
  payload: json(row.payload),
  model: row.model,
  ...(row.handle == null ? {} : { handle: row.handle }),
  ...(row.kind === "wake" ? { kind: "wake" as const } : {}),
  ...(row.replaces == null ? {} : { replaces: row.replaces }),
});

const toPayload = (row: any): PayloadRecord => ({
  handle: row.handle,
  conversationId: row.conversation_id,
  component: row.component,
  version: Number(row.version),
  props: json(row.props),
  mode: row.mode,
  createdAt: Number(row.created_at_ms),
  staleAfterMs:
    row.stale_after_ms == null ? null : row.stale_after_ms === "Infinity" ? "never" : Number(row.stale_after_ms),
});

const newToken = () => globalThis.crypto.randomUUID();
const newId = () => `conv_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;

export function pgStore(db: Queryable, options: PgStoreOptions = {}): StoreAdapter {
  const leaseMs = options.leaseMs ?? LEASE_MS;
  // Zero or negative makes every lease expire the moment it is taken, so every
  // load acquires and the one-turn-in-flight guarantee silently disappears.
  // Infinity would strand a crashed turn's conversation forever. Refuse both
  // here, loudly, rather than run with no mutual exclusion at all.
  if (!Number.isFinite(leaseMs) || leaseMs <= 0) {
    throw new RangeError(`leaseMs must be a positive, finite number of milliseconds (got ${leaseMs})`);
  }

  // One LISTEN per channel for the whole store, taken when something first
  // needs it, and each notification handed to whoever wants that conversation.
  const waiting = new Map<string, Set<() => void>>();
  const listening = new Map<string, Promise<unknown>>();
  const listenOn = (listener: Listener, channel: string, onNotify: (payload: string) => void) => {
    let started = listening.get(channel);
    if (!started) {
      started = listener.listen(channel, onNotify).catch((err) => {
        // try again next time, rather than never
        listening.delete(channel);
        throw err;
      });
      listening.set(channel, started);
    }
    return started;
  };
  const listen = (listener: Listener) =>
    listenOn(listener, NOTICE_CHANNEL, (id) => {
      for (const wake of waiting.get(id) ?? []) wake();
    });

  // ── publish / subscribe, over NOTIFY ───────────────────────────────────
  // A message goes out as pieces of at most PIECE base64 characters, each
  // `<conversation> <message id> <index> <count> <piece>`, all in one
  // statement, and is put back together on the way in. Messages from this
  // store are sent one at a time per conversation, each committed before the
  // next starts, so they arrive in the order they were published.
  const hearing = new Map<string, Set<(message: string) => void>>();
  const partial = new Map<string, { pieces: string[]; got: number; expire: ReturnType<typeof setTimeout> }>();
  const sending = new Map<string, Promise<void>>();

  const onTurn = (payload: string) => {
    const [conversationId, id, index, count, piece] = String(payload).split(" ");
    if (!hearing.has(conversationId)) return;
    // The channel is shared, and anything may NOTIFY on it: a piece that
    // doesn't hold together is dropped, never let throw out of the listener.
    const n = Number(count);
    const i = Number(index);
    if (!id || !Number.isSafeInteger(n) || n < 1 || n > MAX_PIECES || !Number.isSafeInteger(i) || i < 0 || i >= n) return;
    const known = partial.get(id);
    if (known && known.pieces.length !== n) return;
    let entry = known;
    if (!entry) {
      // A message whose other pieces never come (a listening connection that
      // dropped part way) is given up on after a while, whatever else arrives.
      const expire = setTimeout(() => partial.delete(id), PIECE_TIMEOUT_MS);
      // and is no reason to keep the process alive
      (expire as { unref?: () => void }).unref?.();
      entry = { pieces: new Array<string>(n), got: 0, expire };
    }
    if (entry.pieces[i] === undefined) entry.got++;
    entry.pieces[i] = piece ?? "";
    if (entry.got < n) return void partial.set(id, entry);
    clearTimeout(entry.expire);
    partial.delete(id);
    let message: string;
    try {
      message = new TextDecoder("utf-8", { fatal: true }).decode(
        Uint8Array.from(atob(entry.pieces.join("")), (c) => c.charCodeAt(0)),
      );
    } catch {
      return; // not base64, or not UTF-8 once decoded: not one of ours
    }
    for (const hear of [...(hearing.get(conversationId) ?? [])]) hear(message);
  };

  async function publish(conversationId: string, message: string) {
    const bytes = new TextEncoder().encode(String(message));
    // Refused here rather than sent and dropped by every listener, and before
    // any of the work of encoding it.
    if (bytes.length > MAX_PUBLISH_BYTES) {
      throw new RangeError(
        `message too long to publish: ${bytes.length} bytes, over the ${MAX_PUBLISH_BYTES}-byte maximum`,
      );
    }
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    const encoded = btoa(binary);
    const id = newToken().replaceAll("-", "");
    const count = Math.max(1, Math.ceil(encoded.length / PIECE));
    const pieces = Array.from({ length: count }, (_, i) =>
      `${conversationId} ${id} ${i} ${count} ${encoded.slice(i * PIECE, (i + 1) * PIECE)}`,
    );
    const before = sending.get(conversationId) ?? Promise.resolve();
    const sent = before.then(() =>
      db.query(`SELECT pg_notify('${TURN_CHANNEL}', piece) FROM jsonb_array_elements_text($1::jsonb) AS piece`, [
        JSON.stringify(pieces),
      ]),
    );
    const settled = sent.then(
      () => {},
      () => {},
    );
    sending.set(conversationId, settled);
    try {
      await sent;
    } finally {
      if (sending.get(conversationId) === settled) sending.delete(conversationId);
    }
  }

  async function subscribe(conversationId: string, onMessage: (message: string) => void, signal: AbortSignal) {
    if (signal.aborted) return;
    const set = hearing.get(conversationId) ?? new Set();
    set.add(onMessage);
    hearing.set(conversationId, set);
    signal.addEventListener(
      "abort",
      () => {
        set.delete(onMessage);
        if (!set.size && hearing.get(conversationId) === set) hearing.delete(conversationId);
      },
      { once: true },
    );
    // Resolves once LISTEN has taken hold, so nothing published after this
    // resolves is missed. Best effort, as the contract says: a failed LISTEN
    // is tried again next time, and this resolves all the same.
    await listenOn(options.listen!, TURN_CHANNEL, onTurn).catch(() => {});
  }

  async function* watch(conversationId: string, signal: AbortSignal): AsyncIterable<void> {
    // One wake-up stands for any number of notices: a step resolves once
    // something has landed since the last, and the caller reads them all.
    let landed = false;
    let wake: (() => void) | null = null;
    const listener = () => {
      landed = true;
      wake?.();
    };
    const onAbort = () => wake?.();
    const set = waiting.get(conversationId) ?? new Set();
    set.add(listener);
    waiting.set(conversationId, set);
    signal.addEventListener("abort", onAbort);
    try {
      await listen(options.listen!);
      // A notice that landed before LISTEN took hold sent its NOTIFY to no
      // one, so the first step is free: the caller reads once now.
      landed = true;
      while (!signal.aborted) {
        if (!landed) await new Promise<void>((r) => (wake = r));
        wake = null;
        if (signal.aborted) return;
        landed = false;
        yield;
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
      set.delete(listener);
      if (!set.size) waiting.delete(conversationId);
    }
  }

  /** A fenced write matched nothing. Say which of the two reasons applies. */
  async function stale(conversationId: string): Promise<never> {
    const { rows } = await db.query(`SELECT 1 FROM haikit_conversations WHERE id = $1`, [conversationId]);
    throw rows.length
      ? new StaleLease(conversationId)
      : new StaleLease(conversationId, "does not exist — no lease was ever issued for it");
  }

  return {
    async loadConversation(id) {
      if (id) {
        // Acquisition in one statement: the expiry check and the new token are
        // the same UPDATE, so two instances cannot both see "expired" and both
        // acquire. The row lock serialises them; the loser re-evaluates the
        // WHERE clause against the winner's committed lease and matches nothing.
        const { rows } = await db.query(
          `UPDATE haikit_conversations
              SET lease_until = now() + $2::float8 * interval '1 millisecond',
                  lease_token = $3
            WHERE id = $1 AND (lease_until IS NULL OR lease_until <= now())
            RETURNING ${CONVERSATION_COLUMNS}`,
          [id, leaseMs, newToken()],
        );
        if (rows[0]) return toConversation(rows[0]);

        // Nothing matched: either someone holds the lease, or there is no such
        // conversation. This second read only picks the error — it decides
        // nothing about who holds the lease.
        const exists = await db.query(`SELECT 1 FROM haikit_conversations WHERE id = $1`, [id]);
        if (exists.rows.length) throw new ConversationBusy(id);
        // An unknown id starts a fresh conversation, as memoryStore does.
      }

      const { rows } = await db.query(
        `INSERT INTO haikit_conversations (id, status, lease_until, lease_token)
         VALUES ($1, 'idle', now() + $2::float8 * interval '1 millisecond', $3)
         RETURNING ${CONVERSATION_COLUMNS}`,
        [newId(), leaseMs, newToken()],
      );
      return toConversation(rows[0]);
    },

    async saveConversation(conversation) {
      // Compare-and-set on the token. A null token or an unknown id matches no
      // row (NULL = x is never true), which is exactly the contract: saving is
      // not an upsert, and a superseded holder cannot overwrite the winner.
      const { rows } = await db.query(
        `UPDATE haikit_conversations
            SET status      = $3,
                messages    = $4::jsonb,
                handles     = $5::jsonb,
                frozen      = $6::jsonb,
                pending     = $7::jsonb,
                lease_until = to_timestamp($8::float8 / 1000),
                noticed_through = $9::integer,
                wakes       = $10::jsonb,
                woke_through = $11::integer,
                wake_turns  = $12::integer,
                superseded  = $13::jsonb,
                updated_at  = now()
          WHERE id = $1 AND lease_token = $2
          RETURNING id`,
        [
          conversation.id,
          conversation.leaseToken,
          conversation.status,
          JSON.stringify(conversation.messages),
          JSON.stringify(conversation.handles),
          JSON.stringify(conversation.frozen),
          // SQL NULL, not the JSON value null — keep "no pending turn" queryable
          conversation.pending == null ? null : JSON.stringify(conversation.pending),
          conversation.leaseUntil,
          conversation.noticedThrough ?? 0,
          JSON.stringify(conversation.wakes ?? []),
          conversation.wokeThrough ?? 0,
          conversation.wakeTurns ?? 0,
          JSON.stringify(conversation.superseded ?? {}),
        ],
      );
      if (!rows.length) await stale(conversation.id);
    },

    async putPayload(record, leaseToken) {
      // Fence, number and insert in one statement. The CTE's UPDATE both checks
      // the token and takes the next handle number under the row lock, so
      // concurrent renders in one conversation never share a handle. If the
      // token does not match, `owner` is empty and nothing is inserted.
      const { rows } = await db.query(
        `WITH owner AS (
           UPDATE haikit_conversations
              SET handle_seq = handle_seq + 1
            WHERE id = $1::text AND lease_token = $2::text
            RETURNING handle_seq
         )
         INSERT INTO haikit_payloads
                (conversation_id, handle, component, version, props, mode, lease_token, stale_after_ms)
         SELECT $1::text,
                -- ui_01 … ui_09, ui_10 … ui_99, ui_100: pad, never truncate
                'ui_' || CASE WHEN handle_seq < 10 THEN '0' ELSE '' END || handle_seq,
                $3::text, $4::integer, $5::jsonb, $6::text, $2::text, $7::float8
           FROM owner
         RETURNING handle`,
        [
          record.conversationId,
          leaseToken,
          record.component,
          record.version,
          JSON.stringify(record.props),
          record.mode,
          record.staleAfterMs === "never" ? "Infinity" : (record.staleAfterMs ?? null),
        ],
      );
      if (!rows.length) await stale(record.conversationId);
      return rows[0].handle;
    },

    /** Scoped: a handle is only meaningful inside its own conversation. */
    async getPayload(handle, conversationId) {
      const { rows } = await db.query(
        `SELECT ${PAYLOAD_COLUMNS} FROM haikit_payloads WHERE conversation_id = $1 AND handle = $2`,
        [conversationId, handle],
      );
      return rows[0] ? toPayload(rows[0]) : null;
    },

    async getPayloads(handles, conversationId) {
      if (!handles.length) return [];
      // The list travels as jsonb rather than a native array parameter, which
      // not every driver encodes the same way.
      const { rows } = await db.query(
        `SELECT ${PAYLOAD_COLUMNS} FROM haikit_payloads
          WHERE conversation_id = $1
            AND handle IN (SELECT jsonb_array_elements_text($2::jsonb))`,
        [conversationId, JSON.stringify(handles)],
      );
      // `IN` returns each row once; the contract is one result per input
      // handle, duplicates and order included — map the input, not the rows.
      // Each occurrence is a deep copy, as a separate getPayload would be: a
      // shallow spread would hand two results one shared `props` object.
      const byHandle = new Map(rows.map((row) => [row.handle, toPayload(row)] as const));
      return handles.flatMap((h) => {
        const record = byHandle.get(h);
        return record ? [structuredClone(record)] : [];
      });
    },

    async putNotice(record) {
      // Number, insert and notify in one statement. The UPDATE takes the next
      // number under the conversation's row lock, so two notices in one
      // conversation commit in the order they were numbered and a reader never
      // sees a later one before an earlier. No conversation, no row from
      // `next`, nothing inserted. Unfenced: no lease token is checked.
      const { rows } = await db.query(
        `WITH next AS (
           UPDATE haikit_conversations SET notice_seq = notice_seq + 1
            WHERE id = $1::text
            RETURNING notice_seq
         ), stored AS (
           INSERT INTO haikit_notices (conversation_id, seq, name, version, payload, model, handle, kind, replaces)
           SELECT $1::text, notice_seq, $2::text, $3::integer, $4::jsonb, $5::text, $6::text, $7::text, $8::text FROM next
           RETURNING ${NOTICE_COLUMNS}
         )
         SELECT stored.*, pg_notify('${NOTICE_CHANNEL}', $1::text) FROM stored`,
        [
          record.conversationId,
          record.name,
          record.version,
          JSON.stringify(record.payload ?? null),
          record.model,
          record.handle ?? null,
          record.kind === "wake" ? "wake" : null,
          record.replaces ?? null,
        ],
      );
      if (!rows.length) throw new Error(`conversation ${record.conversationId} does not exist`);
      return toNotice(rows[0]);
    },

    async getNotices(conversationId, after, limit) {
      const { rows } = await db.query(
        `SELECT ${NOTICE_COLUMNS} FROM haikit_notices
          WHERE conversation_id = $1 AND seq > $2::bigint
          ORDER BY seq
          LIMIT $3::integer`,
        [conversationId, after, limit ?? null],
      );
      if (rows.length) return rows.map(toNotice);
      // nothing to return: say which of the two reasons applies
      const exists = await db.query(`SELECT 1 FROM haikit_conversations WHERE id = $1`, [conversationId]);
      return exists.rows.length ? [] : null;
    },

    // Anyone can publish; hearing it takes a LISTEN connection.
    publish,
    ...(options.listen ? { watch, subscribe } : {}),
  };
}

export interface SweepOptions {
  /**
   * Only sweep rows at least this old. A grace period for operators, not a
   * safety bound: whether a row is an orphan is decided by lease tokens below,
   * so no value here can delete a payload a turn is still going to reference.
   */
  olderThanMs: number;
}

/**
 * Delete orphaned payloads: rows written by a turn that can never save the
 * history that would reference them.
 *
 * A turn inserts its payloads before it saves, so an unreferenced row is not
 * evidence of anything by itself — the turn may simply not have saved yet. Nor
 * is an expired lease: a turn slower than its TTL keeps running, and if nobody
 * took the conversation over, its save still succeeds. The only proof that a
 * writer is finished is that the conversation's lease has since been issued to
 * someone else. Every payload records the token its writer held, and a row is
 * swept only when it is unreferenced *and* that token has been superseded.
 *
 * Consequence: a turn that crashed leaves its rows until the conversation is
 * next used, since only then is a new token issued. That is the safe direction.
 * Deleting conversations themselves is retention policy, and is left to you.
 */
export async function sweepOrphans(db: Queryable, options: SweepOptions): Promise<{ deleted: number }> {
  const { rows } = await db.query(
    `DELETE FROM haikit_payloads p
      USING haikit_conversations c
      WHERE p.conversation_id = c.id
        AND p.created_at < now() - $1::float8 * interval '1 millisecond'
        AND p.lease_token IS DISTINCT FROM c.lease_token
        AND NOT (c.handles @> jsonb_build_array(p.handle))
      RETURNING p.handle`,
    [options.olderThanMs],
  );
  return { deleted: rows.length };
}
