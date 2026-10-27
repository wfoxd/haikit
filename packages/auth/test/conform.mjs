#!/usr/bin/env node
/**
 * The AuthStore contract, against `memoryAuthStore` and `pgAuthStore` on
 * PGlite: a conversation never changes hands, a revocation time only moves
 * later, and the Postgres store keeps both across a restart.
 *
 *   node packages/auth/test/conform.mjs
 */

import { PGlite } from "@electric-sql/pglite";
import { memoryAuthStore } from "../dist/index.js";
import { pgAuthStore, migrate, schema } from "../dist/postgres.js";

let failures = 0;
const check = (label, ok) => {
  console.log(`  ${ok ? "\x1b[32m✓" : "\x1b[31m✗"}\x1b[0m ${label}`);
  if (!ok) failures++;
};
const rejects = async (fn) => {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
};

/** @param {() => import("../dist/index.js").AuthStore} make */
async function conform(label, make) {
  console.log(`\n${label}`);
  const s = make();

  check("an unknown conversation has no owner", (await s.getOwner("conv_x")) === null);
  await s.setOwner("conv_a", "ada");
  check("an owner, once set, is read back", (await s.getOwner("conv_a")) === "ada");
  await s.setOwner("conv_a", "ada");
  check("setting the same owner again changes nothing", (await s.getOwner("conv_a")) === "ada");
  check("another owner is refused", await rejects(() => s.setOwner("conv_a", "bob")));
  check("…and the first one stays", (await s.getOwner("conv_a")) === "ada");
  await s.setOwner("conv_b", "bob");
  check("owners are kept per conversation", (await s.getOwner("conv_b")) === "bob" && (await s.getOwner("conv_a")) === "ada");

  check("a user never revoked has no time", (await s.getNotBefore("ada")) === null);
  const t = Date.UTC(2026, 9, 27, 9, 30, 15, 250);
  await s.setNotBefore("ada", t);
  check("a revocation time is read back to the millisecond", (await s.getNotBefore("ada")) === t);
  await s.setNotBefore("ada", t - 60_000);
  check("an earlier one changes nothing", (await s.getNotBefore("ada")) === t);
  await s.setNotBefore("ada", t + 60_000);
  check("a later one wins", (await s.getNotBefore("ada")) === t + 60_000);
  check("revocations are kept per user", (await s.getNotBefore("bob")) === null);
}

await conform("memoryAuthStore", () => memoryAuthStore());

const db = new PGlite();
await migrate(db);
await conform("pgAuthStore (PGlite)", () => pgAuthStore(db));

console.log("\npgAuthStore (PGlite) — adapter");
await migrate(db);
check("migrate runs twice without complaint", true);
check("the schema is one statement per entry", schema.length === 3 && schema.every((q) => !q.trim().endsWith(";")));
check("a new store on the same database knows the owners and revocations", (await pgAuthStore(db).getOwner("conv_a")) === "ada" && (await pgAuthStore(db).getNotBefore("ada")) !== null);
{
  // two claims at once: one wins, and the other is told
  const s = pgAuthStore(db);
  const results = await Promise.allSettled([s.setOwner("conv_race", "ada"), s.setOwner("conv_race", "bob")]);
  const owner = await s.getOwner("conv_race");
  check(
    "two claims on one conversation at once: one owner, and the loser refused",
    (owner === "ada" || owner === "bob") && results.filter((r) => r.status === "rejected").length === 1,
  );
}
await db.close();

console.log(failures ? `\n${failures} check(s) failed\n` : "\nauth store: all checks passed\n");
process.exit(failures ? 1 : 0);
