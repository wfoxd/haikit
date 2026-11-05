/**
 * The CredentialStore contract, which `memoryCredentialStore` (in mcptest)
 * and `pgCredentialStore` (in pgtest) must both keep: a write lands only on
 * the value it expects, a delete with a value takes only that one, a refresh
 * lease has one holder at a time, flows are taken once, and nothing crosses
 * from one user, server or issuer to another.
 */

/**
 * @param {string} label
 * @param {() => import("../dist/index.js").CredentialStore} make
 * @param {(label: string, ok: boolean) => void} check
 */
export async function conform(label, make, check) {
  console.log(`\n${label}`);
  const s = make();

  check("an unknown credential is null", (await s.get("ada", "github")) === null);
  check("a first write, onto no row, lands", (await s.put("ada", "github", "v1", null)) === true);
  check("…and is read back", (await s.get("ada", "github")) === "v1");
  check("a second first write is refused: the row is there", (await s.put("ada", "github", "v0", null)) === false);
  check("a write onto a value the row no longer holds is refused", (await s.put("ada", "github", "v2", "v0")) === false);
  check("…and leaves the row as it was", (await s.get("ada", "github")) === "v1");
  check("a write onto the value it holds lands", (await s.put("ada", "github", "v2", "v1")) === true && (await s.get("ada", "github")) === "v2");
  check("a write onto a row that isn't there is refused", (await s.put("ada", "linear", "x", "v2")) === false && (await s.get("ada", "linear")) === null);

  await s.put("ada", "linear", "l1", null);
  await s.put("bob", "github", "b1", null);
  check("credentials are kept per user and server", (await s.get("bob", "github")) === "b1" && (await s.get("ada", "linear")) === "l1");
  check("list names a user's servers", JSON.stringify((await s.list("ada")).sort()) === JSON.stringify(["github", "linear"]));
  check("…and no one else's", JSON.stringify(await s.list("bob")) === JSON.stringify(["github"]) && (await s.list("cy")).length === 0);

  await s.delete("ada", "github", "v1");
  check("a delete with a value the row no longer holds does nothing", (await s.get("ada", "github")) === "v2");
  await s.delete("ada", "github", "v2");
  check("a delete with the value it holds deletes it", (await s.get("ada", "github")) === null && (await s.get("ada", "linear")) === "l1");
  await s.put("ada", "github", "v3", null);
  await s.delete("ada", "github");
  check("a delete with no value deletes whatever is there", (await s.get("ada", "github")) === null);
  await s.put("ada", "github", "v4", null);
  await s.delete("ada");
  check("a delete with no server deletes all of a user's", (await s.list("ada")).length === 0 && (await s.get("ada", "linear")) === null);
  check("…and nobody else's", (await s.get("bob", "github")) === "b1");
  await s.delete("nobody");
  await s.delete("nobody", "github", "x");
  check("deleting what isn't there is fine", (await s.list("nobody")).length === 0);

  {
    const results = await Promise.all([s.put("race", "github", "a", null), s.put("race", "github", "b", null)]);
    const now = await s.get("race", "github");
    check("two first writes at once: one lands, and the other is refused", results.filter(Boolean).length === 1 && (now === "a" || now === "b"));
    const next = await Promise.all([s.put("race", "github", "c", now), s.put("race", "github", "d", now)]);
    const after = await s.get("race", "github");
    check("two writes onto the same value at once: one lands", next.filter(Boolean).length === 1 && (after === "c" || after === "d"));
  }

  {
    await s.put("lea", "github", "l1", null);
    check("a lease on the value the row holds is taken", (await s.lease("lea", "github", "l1", "p1", 60_000)) === true);
    check("…and not by another holder while it lasts", (await s.lease("lea", "github", "l1", "p2", 60_000)) === false);
    check("…but by its own again", (await s.lease("lea", "github", "l1", "p1", 60_000)) === true);
    check("a lease on a value the row no longer holds is refused", (await s.lease("lea", "github", "l0", "p3", 60_000)) === false);
    check("…as on a row that isn't there", (await s.lease("lea", "linear", "l1", "p3", 60_000)) === false && (await s.get("lea", "linear")) === null);
    check("another holder can't give it back", (await s.lease("lea", "github", "l1", "p2", 0)) === false);
    check("its own holder can, with ms 0", (await s.lease("lea", "github", "l1", "p1", 0)) === true);
    check("…and then another takes it", (await s.lease("lea", "github", "l1", "p2", 200)) === true);
    await new Promise((resolve) => setTimeout(resolve, 300));
    check("a lease lapses after its ms", (await s.lease("lea", "github", "l1", "p3", 60_000)) === true);
    check("a lease is no write: the value is as it was", (await s.get("lea", "github")) === "l1");
    check("a write onto a leased row lands", (await s.put("lea", "github", "l2", "l1")) === true);
    check("…and ends its lease", (await s.lease("lea", "github", "l2", "p4", 60_000)) === true);
    await s.delete("lea", "github");
    await s.put("lea", "github", "l3", null);
    check("so does a delete", (await s.lease("lea", "github", "l3", "p5", 60_000)) === true);
    await s.delete("lea");
    await s.put("lea", "github", "l4", null);
    check("…of all the user's", (await s.lease("lea", "github", "l4", "p6", 60_000)) === true);
    const taken = await Promise.all([s.lease("lea", "github", "l4", "a", 60_000), s.lease("lea", "github", "l4", "b", 60_000)]);
    check("two leases by others at once, on a row whose lease is held: neither", !taken.includes(true));
    await s.put("lea2", "github", "m1", null);
    const both = await Promise.all([s.lease("lea2", "github", "m1", "a", 60_000), s.lease("lea2", "github", "m1", "b", 60_000)]);
    check("two leases at once: one is taken", both.filter(Boolean).length === 1);
    check("leases are kept per user and server", (await s.lease("lea2", "linear", "m1", "c", 60_000)) === false && (await s.put("lea3", "github", "n1", null)) && (await s.lease("lea3", "github", "n1", "c", 60_000)) === true);
  }

  check("an unknown client is null", (await s.getClient("github", "https://github.com")) === null);
  await s.putClient("github", "https://github.com", "c1");
  check("a client is read back", (await s.getClient("github", "https://github.com")) === "c1");
  await s.putClient("github", "https://github.com", "c2");
  check("…and replaced", (await s.getClient("github", "https://github.com")) === "c2");
  check(
    "clients are kept per server and issuer",
    (await s.getClient("github", "https://other.example")) === null && (await s.getClient("linear", "https://github.com")) === null,
  );

  const later = Date.now() + 600_000;
  await s.putFlow("st-1", "f1", later);
  check("a flow is taken", (await s.takeFlow("st-1")) === "f1");
  check("…once", (await s.takeFlow("st-1")) === null);
  check("an unknown flow is null", (await s.takeFlow("st-x")) === null);
  await s.putFlow("st-old", "f0", Date.now() - 1_000);
  check("an expired flow is null", (await s.takeFlow("st-old")) === null);
  await s.putFlow("st-2", "f2", later);
  const taken = await Promise.all([s.takeFlow("st-2"), s.takeFlow("st-2")]);
  check("two takes of one flow at once: one gets it", taken.filter((v) => v === "f2").length === 1 && taken.includes(null));
}
