/**
 * @haikit/mcp/postgres — each user's credentials in Postgres, shared by every
 * server. As in @haikit/postgres, every method is one statement, and the
 * driver is yours.
 */

import type { CredentialStore } from "./store.js";

/**
 * Anything that runs a parameterised statement and returns rows: a `pg.Pool`,
 * a `pg.Client` and PGlite all fit as they are. The same shape as
 * @haikit/postgres's and @haikit/auth/postgres's `Queryable`, so one pool
 * serves all three.
 */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

/**
 * The schema, one statement per entry. `migrate()` runs these; export them to
 * your own migration tool instead if you have one.
 */
export const schema: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS haikit_mcp_credentials (
     user_id      text NOT NULL,
     server       text NOT NULL,
     value        text NOT NULL,
     updated_at   timestamptz NOT NULL DEFAULT now(),
     lease_holder text,
     lease_until  timestamptz,
     PRIMARY KEY (user_id, server)
   )`,
  `CREATE TABLE IF NOT EXISTS haikit_mcp_clients (
     server text NOT NULL,
     issuer text NOT NULL,
     value  text NOT NULL,
     PRIMARY KEY (server, issuer)
   )`,
  `CREATE TABLE IF NOT EXISTS haikit_mcp_flows (
     state      text PRIMARY KEY,
     value      text NOT NULL,
     expires_at timestamptz NOT NULL
   )`,
];

export async function migrate(db: Queryable): Promise<void> {
  for (const statement of schema) await db.query(statement);
}

export function pgCredentialStore(db: Queryable): CredentialStore {
  return {
    async get(userId, server) {
      const { rows } = await db.query(`SELECT value FROM haikit_mcp_credentials WHERE user_id = $1 AND server = $2`, [userId, server]);
      return rows[0]?.value ?? null;
    },
    async put(userId, server, value, previous) {
      // One statement each: the check of what the row holds and the write
      // can't come apart, so two servers can't both win.
      const { rows } =
        previous === null
          ? await db.query(
              `INSERT INTO haikit_mcp_credentials (user_id, server, value) VALUES ($1, $2, $3)
               ON CONFLICT (user_id, server) DO NOTHING
               RETURNING 1 AS written`,
              [userId, server, value],
            )
          : await db.query(
              `UPDATE haikit_mcp_credentials SET value = $3, updated_at = now(), lease_holder = NULL, lease_until = NULL
               WHERE user_id = $1 AND server = $2 AND value = $4
               RETURNING 1 AS written`,
              [userId, server, value, previous],
            );
      return rows.length === 1;
    },
    async delete(userId, server, previous) {
      if (server === undefined) {
        await db.query(`DELETE FROM haikit_mcp_credentials WHERE user_id = $1`, [userId]);
      } else if (previous === undefined) {
        await db.query(`DELETE FROM haikit_mcp_credentials WHERE user_id = $1 AND server = $2`, [userId, server]);
      } else {
        await db.query(`DELETE FROM haikit_mcp_credentials WHERE user_id = $1 AND server = $2 AND value = $3`, [userId, server, previous]);
      }
    },
    async list(userId) {
      const { rows } = await db.query(`SELECT server FROM haikit_mcp_credentials WHERE user_id = $1 ORDER BY server`, [userId]);
      return rows.map((row) => row.server as string);
    },
    async lease(userId, server, previous, holder, ms) {
      // by the database's clock, so servers whose clocks differ agree when it lapses
      const { rows } = await db.query(
        `UPDATE haikit_mcp_credentials SET lease_holder = $4, lease_until = now() + $5::float8 * interval '1 millisecond'
         WHERE user_id = $1 AND server = $2 AND value = $3
           AND (lease_until IS NULL OR lease_until <= now() OR lease_holder = $4)
         RETURNING 1 AS leased`,
        [userId, server, previous, holder, ms],
      );
      return rows.length === 1;
    },
    async getClient(server, issuer) {
      const { rows } = await db.query(`SELECT value FROM haikit_mcp_clients WHERE server = $1 AND issuer = $2`, [server, issuer]);
      return rows[0]?.value ?? null;
    },
    async putClient(server, issuer, value) {
      await db.query(
        `INSERT INTO haikit_mcp_clients (server, issuer, value) VALUES ($1, $2, $3)
         ON CONFLICT (server, issuer) DO UPDATE SET value = EXCLUDED.value`,
        [server, issuer, value],
      );
    },
    async putFlow(state, value, expiresAt) {
      // flows never taken go as new ones come, in the same statement
      await db.query(
        `WITH gone AS (DELETE FROM haikit_mcp_flows WHERE expires_at <= now())
         INSERT INTO haikit_mcp_flows (state, value, expires_at) VALUES ($1, $2, to_timestamp($3::float8 / 1000))`,
        [state, value, expiresAt],
      );
    },
    async takeFlow(state) {
      // taken once: a second take of the same state finds nothing
      const { rows } = await db.query(
        `DELETE FROM haikit_mcp_flows WHERE state = $1 RETURNING value, expires_at > now() AS live`,
        [state],
      );
      return rows[0]?.live ? rows[0].value : null;
    },
  };
}
