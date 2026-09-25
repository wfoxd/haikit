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
}

const LEASE_MS = 120_000;

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
     updated_at   timestamptz NOT NULL DEFAULT now()
   )`,
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
     PRIMARY KEY (conversation_id, handle)
   )`,
  `CREATE INDEX IF NOT EXISTS haikit_payloads_created_at ON haikit_payloads (created_at)`,
];

/** Create the tables if they do not exist. Idempotent. */
export async function migrate(db: Queryable): Promise<void> {
  // One statement per call: some drivers (PGlite among them) reject several
  // statements in a single parameterised query.
  for (const statement of schema) await db.query(statement);
}

const CONVERSATION_COLUMNS = `
  id, status, messages, handles, frozen, pending, lease_token,
  (extract(epoch FROM lease_until) * 1000)::float8 AS lease_until_ms`;

const PAYLOAD_COLUMNS = `
  handle, conversation_id, component, version, props, mode,
  (extract(epoch FROM created_at) * 1000)::float8 AS created_at_ms`;

/** Most drivers parse jsonb into values; a few hand back text. Accept both. */
const json = (value: unknown) => (typeof value === "string" ? JSON.parse(value) : value);

const toConversation = (row: any): Conversation => ({
  id: row.id,
  status: row.status,
  messages: json(row.messages),
  handles: json(row.handles),
  frozen: json(row.frozen),
  pending: row.pending == null ? null : json(row.pending),
  leaseUntil: row.lease_until_ms == null ? null : Number(row.lease_until_ms),
  leaseToken: row.lease_token,
});

const toPayload = (row: any): PayloadRecord => ({
  handle: row.handle,
  conversationId: row.conversation_id,
  component: row.component,
  version: Number(row.version),
  props: json(row.props),
  mode: row.mode,
  createdAt: Number(row.created_at_ms),
});

const newToken = () => globalThis.crypto.randomUUID();
const newId = () => `conv_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;

export function pgStore(db: Queryable, options: PgStoreOptions = {}): StoreAdapter {
  const leaseMs = options.leaseMs ?? LEASE_MS;

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
         INSERT INTO haikit_payloads (conversation_id, handle, component, version, props, mode, lease_token)
         SELECT $1::text,
                -- ui_01 … ui_09, ui_10 … ui_99, ui_100: pad, never truncate
                'ui_' || CASE WHEN handle_seq < 10 THEN '0' ELSE '' END || handle_seq,
                $3::text, $4::integer, $5::jsonb, $6::text, $2::text
           FROM owner
         RETURNING handle`,
        [
          record.conversationId,
          leaseToken,
          record.component,
          record.version,
          JSON.stringify(record.props),
          record.mode,
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
