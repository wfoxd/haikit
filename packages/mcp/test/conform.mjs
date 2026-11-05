#!/usr/bin/env node
/**
 * The CredentialStore contract against `pgCredentialStore` on PGlite, and
 * what only the Postgres store does: its schema, migrating twice, values
 * kept across a restart, and flows nobody took swept away.
 *
 *   node packages/mcp/test/conform.mjs
 */

import { PGlite } from "@electric-sql/pglite";
import { pgCredentialStore, migrate, schema } from "../dist/postgres.js";
import { conform } from "./store.mjs";

let failures = 0;
const check = (label, ok) => {
  console.log(`  ${ok ? "\x1b[32m✓" : "\x1b[31m✗"}\x1b[0m ${label}`);
  if (!ok) failures++;
};

const db = new PGlite();
await migrate(db);
await conform("pgCredentialStore (PGlite)", () => pgCredentialStore(db), check);

console.log("\npgCredentialStore (PGlite) — adapter");
await migrate(db);
check("migrate runs twice without complaint", true);
check("the schema is one statement per entry", schema.length === 3 && schema.every((q) => !q.trim().endsWith(";")));
{
  const s = pgCredentialStore(db);
  await s.put("kept", "github", "sealed", null);
  await s.putClient("github", "https://github.com", "client");
  check(
    "a new store on the same database has the credentials and clients",
    (await pgCredentialStore(db).get("kept", "github")) === "sealed" && (await pgCredentialStore(db).getClient("github", "https://github.com")) === "client",
  );
  await s.putFlow("st-stale", "f", Date.now() - 1_000);
  await s.putFlow("st-new", "f", Date.now() + 600_000);
  const { rows } = await db.query(`SELECT state FROM haikit_mcp_flows ORDER BY state`);
  check("a flow nobody took is swept away as another comes", JSON.stringify(rows.map((r) => r.state)) === JSON.stringify(["st-new"]));
  const { rows: stamped } = await db.query(`SELECT extract(epoch FROM updated_at) AS at FROM haikit_mcp_credentials WHERE user_id = 'kept'`);
  check("a credential says when it was written", Math.abs(Number(stamped[0].at) * 1000 - Date.now()) < 60_000);
  const writtenAt = async () => (await db.query(`SELECT updated_at::text AS at FROM haikit_mcp_credentials WHERE user_id = 'kept'`)).rows[0].at;
  const at = await writtenAt();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await s.lease("kept", "github", "sealed", "p", 60_000);
  check("a lease isn't a write: updated_at stays", (await writtenAt()) === at);
}
await db.close();

console.log(failures ? `\n${failures} check(s) failed\n` : "\nmcp credential store: all checks passed\n");
process.exit(failures ? 1 : 0);
