/**
 * @haikit/auth/postgres — ownership and revocations in Postgres, shared by
 * every server. As in @haikit/postgres, every method is one statement, and
 * the driver is yours.
 */

import type { AuthStore } from "./index.js";

/**
 * Anything that runs a parameterised statement and returns rows: a `pg.Pool`,
 * a `pg.Client` and PGlite all fit as they are. The same shape as
 * @haikit/postgres's `Queryable`, so one pool serves both.
 */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

/**
 * The schema, one statement per entry. `migrate()` runs these; export them to
 * your own migration tool instead if you have one.
 */
export const schema: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS haikit_auth_owners (
     conversation_id text PRIMARY KEY,
     user_id         text NOT NULL,
     created_at      timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS haikit_auth_owners_user ON haikit_auth_owners (user_id)`,
  `CREATE TABLE IF NOT EXISTS haikit_auth_revocations (
     user_id    text PRIMARY KEY,
     not_before timestamptz NOT NULL
   )`,
];

export async function migrate(db: Queryable): Promise<void> {
  for (const statement of schema) await db.query(statement);
}

export function pgAuthStore(db: Queryable): AuthStore {
  return {
    async getOwner(conversationId) {
      const { rows } = await db.query(`SELECT user_id FROM haikit_auth_owners WHERE conversation_id = $1`, [conversationId]);
      return rows[0]?.user_id ?? null;
    },
    async setOwner(conversationId, userId) {
      // One statement: a second claim leaves the row as it was, and returns
      // the owner it has, so two servers can't both win.
      const { rows } = await db.query(
        `INSERT INTO haikit_auth_owners (conversation_id, user_id) VALUES ($1, $2)
         ON CONFLICT (conversation_id) DO UPDATE SET user_id = haikit_auth_owners.user_id
         RETURNING user_id`,
        [conversationId, userId],
      );
      if (rows[0]?.user_id !== userId) throw new Error(`conversation ${conversationId} already belongs to someone else`);
    },
    async getNotBefore(userId) {
      const { rows } = await db.query(
        `SELECT extract(epoch FROM not_before) * 1000 AS at FROM haikit_auth_revocations WHERE user_id = $1`,
        [userId],
      );
      return rows[0] ? Number(rows[0].at) : null;
    },
    async setNotBefore(userId, at) {
      await db.query(
        `INSERT INTO haikit_auth_revocations (user_id, not_before) VALUES ($1, to_timestamp($2::float8 / 1000))
         ON CONFLICT (user_id) DO UPDATE SET not_before = GREATEST(haikit_auth_revocations.not_before, EXCLUDED.not_before)`,
        [userId, at],
      );
    },
  };
}
