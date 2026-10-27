#!/usr/bin/env node
/**
 * @haikit/auth: what createAuth refuses, the tokens it issues and accepts,
 * its gate's answers, its routes, and the gate in front of real HaiKIT routes.
 *
 *   node packages/auth/test/auth.mjs
 */

import http from "node:http";
import { SignJWT, generateKeyPair, exportJWK } from "jose";
import { createAuth, memoryAuthStore } from "../dist/index.js";

let failures = 0;
const check = (label, ok) => {
  console.log(`  ${ok ? "\x1b[32m✓" : "\x1b[31m✗"}\x1b[0m ${label}`);
  if (!ok) failures++;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const throws = (fn, message) => {
  try {
    fn();
    return false;
  } catch (err) {
    return err.message === message;
  }
};
const rejects = async (fn, message) => {
  try {
    await fn();
    return false;
  } catch (err) {
    return err.message === message;
  }
};

const SECRET = "a-secret-for-tests-that-is-long-enough";
const OLD_SECRET = "the-secret-that-came-before-this-one!!";
const key = (s) => new TextEncoder().encode(s);
/** A response stand-in that keeps the headers set on it. */
const fakeRes = () => {
  const headers = {};
  return { headers, getHeader: (n) => headers[n], setHeader: (n, v) => (headers[n] = v) };
};
const cookieFrom = (res) => [res.headers["set-cookie"]].flat().at(-1);
const tokenIn = (cookie) => cookie.split(";")[0].split("=").slice(1).join("=");
const quietly = async (fn) => {
  const error = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.map(String).join(" "));
  try {
    await fn();
  } finally {
    console.error = error;
  }
  return logged;
};

// ── createAuth refuses what can't work ──────────────────────────────────
console.log("\ncreateAuth");
{
  const store = memoryAuthStore();
  check("no secret and no jwks", throws(() => createAuth({ store, jwt: {} }), "createAuth: jwt needs a secret, a jwks URL, or both"));
  check("a secret under 32 bytes", throws(() => createAuth({ store, jwt: { secret: [SECRET, "short"] } }), "createAuth: each jwt secret must be at least 32 bytes"));
  check('"none", in any case', throws(() => createAuth({ store, jwt: { secret: SECRET, algorithms: ["None"] } }), 'createAuth: "none" is not an algorithm a token may use'));
  check("an asymmetric algorithm with no jwks", throws(() => createAuth({ store, jwt: { secret: SECRET, algorithms: ["HS256", "RS256"] } }), "createAuth: RS256 needs jwt.jwks"));
  check("an HS algorithm with no secret", throws(() => createAuth({ store, jwt: { jwks: "https://idp.test/jwks", algorithms: ["HS256"] } }), "createAuth: HS256 needs jwt.secret"));
  check("an unknown algorithm", throws(() => createAuth({ store, jwt: { secret: SECRET, algorithms: ["XS999"] } }), "createAuth: unknown algorithm XS999"));
  check(
    "a secret with no HS algorithm allowed",
    throws(() => createAuth({ store, jwt: { secret: SECRET, jwks: "https://idp.test/jwks", algorithms: ["ES256"] } }), "createAuth: jwt.secret is given, but jwt.algorithms allows no HS algorithm"),
  );
  check("a jwks that isn't a URL", throws(() => createAuth({ store, jwt: { jwks: "not a url" } }), "createAuth: jwt.jwks must be a URL"));
  check("a ttlMs under a second", throws(() => createAuth({ store, jwt: { secret: SECRET, ttlMs: 999 } }), "createAuth: jwt.ttlMs must be at least 1000"));
  check("a __Host- cookie that isn't secure", throws(() => createAuth({ store, jwt: { secret: SECRET }, cookie: { secure: false, name: "__Host-x" } }), "createAuth: a __Host- cookie must be secure"));
  check("a cookie name with a space", throws(() => createAuth({ store, jwt: { secret: SECRET }, cookie: { name: "my token" } }), "createAuth: cookie.name isn't a valid cookie name"));
  check("an origin that isn't one", throws(() => createAuth({ store, jwt: { secret: SECRET }, origins: ["app.example.com"] }), "createAuth: app.example.com isn't an origin such as https://app.example.com"));
}

// ── tokens it issues ────────────────────────────────────────────────────
console.log("\ntokens");
{
  const auth = createAuth({ store: memoryAuthStore(), jwt: { secret: SECRET, issuer: "https://app.test", audience: "haikit" } });
  const res = fakeRes();
  const before = Math.floor(Date.now() / 1000);
  const token = await auth.signIn(res, "ada", { name: "Ada", role: "admin" });
  const cookie = cookieFrom(res);
  check(
    "signIn sets the cookie: __Host-, the token, a week, HttpOnly, Lax, Secure, Path=/",
    cookie === `__Host-haikit_token=${token}; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax; Secure`,
  );
  const user = await auth.verify(token);
  const c = user?.claims ?? {};
  check("the token names the user, with the app's claims", user?.id === "ada" && c.sub === "ada" && c.name === "Ada" && c.role === "admin");
  check(
    "…and iat, exp a week on, a jti, the issuer and the audience",
    c.iat >= before && c.exp - c.iat === 604_800 && typeof c.jti === "string" && c.jti.length === 36 && c.iss === "https://app.test" && c.aud === "haikit",
  );
  const other = await auth.signIn(fakeRes(), "ada");
  check("each token gets its own jti", (await auth.verify(other)).claims.jti !== c.jti);
  check("a claim signIn sets itself is refused", await rejects(() => auth.signIn(fakeRes(), "ada", { exp: 1 }), 'signIn: "exp" is set by signIn, not by claims'));
  check("an empty user id is refused", await rejects(() => auth.signIn(fakeRes(), ""), "signIn: userId must be a non-empty string"));
  const kept = fakeRes();
  kept.setHeader("set-cookie", "theme=dark; Path=/");
  await auth.signIn(kept, "ada");
  check("a cookie the response already had is kept", kept.headers["set-cookie"].length === 2 && kept.headers["set-cookie"][0] === "theme=dark; Path=/");
  const out = fakeRes();
  auth.signOut(out);
  check("signOut clears the cookie", cookieFrom(out) === "__Host-haikit_token=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax; Secure");

  const plain = createAuth({ store: memoryAuthStore(), jwt: { secret: SECRET, ttlMs: 3_600_000 }, cookie: { secure: false } });
  const devRes = fakeRes();
  await plain.signIn(devRes, "ada");
  check("not secure: haikit_token, no Secure, and Max-Age from ttlMs", /^haikit_token=[^;]+; Max-Age=3600; Path=\/; HttpOnly; SameSite=Lax$/.test(cookieFrom(devRes)));

  // what it refuses
  const tampered = token.slice(0, -2) + (token.at(-2) === "A" ? "B" : "A") + token.at(-1);
  const forged = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject("ada").setIssuedAt().setExpirationTime("1h").setIssuer("https://app.test").setAudience("haikit").sign(key("somebody-else's-secret-of-enough-size"));
  const expired = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject("ada").setIssuedAt(Math.floor(Date.now() / 1000) - 120).setExpirationTime(Math.floor(Date.now() / 1000) - 60).setIssuer("https://app.test").setAudience("haikit").sign(key(SECRET));
  const strangerIss = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject("ada").setIssuedAt().setExpirationTime("1h").setIssuer("https://evil.test").setAudience("haikit").sign(key(SECRET));
  const strangerAud = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject("ada").setIssuedAt().setExpirationTime("1h").setIssuer("https://app.test").setAudience("other").sign(key(SECRET));
  const none = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(JSON.stringify({ sub: "ada", iss: "https://app.test", aud: "haikit", exp: 9_999_999_999 })).toString("base64url")}.`;
  const noSubject = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").setIssuer("https://app.test").setAudience("haikit").sign(key(SECRET));
  const results = await Promise.all([tampered, forged, expired, strangerIss, strangerAud, none, noSubject, "not.a.jwt", ""].map((t) => auth.verify(t)));
  check("refused: a changed byte, another secret, expired, another issuer or audience, alg none, no subject, garbage", results.every((r) => r === null));

  // rotation
  const old = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject("ada").setIssuedAt().setExpirationTime("1h").sign(key(OLD_SECRET));
  const rotated = createAuth({ store: memoryAuthStore(), jwt: { secret: [SECRET, OLD_SECRET] } });
  const fresh = await rotated.signIn(fakeRes(), "ada");
  check("a token signed with a secret being rotated out still verifies", (await rotated.verify(old))?.id === "ada");
  check("…and a new one is signed with the first", (await createAuth({ store: memoryAuthStore(), jwt: { secret: SECRET } }).verify(fresh))?.id === "ada");
  check("…the old secret alone can't verify it", (await createAuth({ store: memoryAuthStore(), jwt: { secret: OLD_SECRET } }).verify(fresh)) === null);
}

// ── an identity provider's tokens, by JWKS ──────────────────────────────
console.log("\nJWKS");
{
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "ES256", use: "sig" };
  let reads = 0;
  let down = false;
  const idp = http.createServer((req, res) => {
    reads++;
    if (down) return res.writeHead(500).end();
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise((r) => idp.listen(0, "127.0.0.1", r));
  const jwks = `http://127.0.0.1:${idp.address().port}/.well-known/jwks.json`;
  const fromIdp = (claims = {}, header = {}) =>
    new SignJWT(claims).setProtectedHeader({ alg: "ES256", kid: "k1", ...header }).setIssuedAt().setExpirationTime("10m").setIssuer("https://idp.test/").setAudience("app").sign(privateKey);
  try {
    const auth = createAuth({ store: memoryAuthStore(), jwt: { jwks, issuer: "https://idp.test/", audience: "app", userClaim: "user_id" } });
    const token = await fromIdp({ user_id: "u_42", email: "a@example.com" });
    const user = await auth.verify(token);
    check("a provider's token verifies against its JWKS, naming the user by userClaim", user?.id === "u_42" && user.claims.email === "a@example.com" && reads === 1);
    check("signIn refuses without a secret", await rejects(() => auth.signIn(fakeRes(), "u_42"), "signIn needs jwt.secret: an identity provider's tokens are issued by the provider"));
    // algorithm confusion: an HS256 token "signed" with the provider's public key
    const confused = await new SignJWT({ user_id: "u_42" }).setProtectedHeader({ alg: "HS256", kid: "k1" }).setIssuedAt().setExpirationTime("10m").setIssuer("https://idp.test/").setAudience("app").sign(key(JSON.stringify(jwk)));
    check("an HS256 token is refused where only a JWKS is configured", (await auth.verify(confused)) === null);
    const { privateKey: stranger } = await generateKeyPair("ES256");
    const foreign = await new SignJWT({ user_id: "u_42" }).setProtectedHeader({ alg: "ES256", kid: "k1" }).setIssuedAt().setExpirationTime("10m").setIssuer("https://idp.test/").setAudience("app").sign(stranger);
    check("a token signed by another key is refused", (await auth.verify(foreign)) === null);
    check("one with no user claim is refused", (await auth.verify(await fromIdp({}))) === null);
    const secretOnly = createAuth({ store: memoryAuthStore(), jwt: { secret: SECRET } });
    check("a provider's token is refused where only a secret is configured", (await secretOnly.verify(token)) === null);

    // both at once
    const both = createAuth({ store: memoryAuthStore(), jwt: { secret: SECRET, jwks, issuer: "https://idp.test/", audience: "app" } });
    const ours = await both.signIn(fakeRes(), "ada");
    check("with both, its own tokens and the provider's verify", (await both.verify(ours))?.id === "ada" && (await both.verify(await fromIdp({ sub: "u_7" })))?.id === "u_7");

    // keys that can't be read are logged, and refuse
    down = true;
    const cold = createAuth({ store: memoryAuthStore(), jwt: { jwks, issuer: "https://idp.test/", audience: "app", userClaim: "user_id" } });
    let refused;
    const logged = await quietly(async () => (refused = await cold.verify(token)));
    check("a JWKS that can't be read refuses the token, and says so in the log", refused === null && logged.some((l) => l.startsWith("[haikit] auth: the JWKS couldn't be read:")));
  } finally {
    idp.close();
  }
}

// ── revocation ──────────────────────────────────────────────────────────
console.log("\nrevocation");
{
  const store = memoryAuthStore();
  const auth = createAuth({ store, jwt: { secret: SECRET } });
  const old = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject("ada").setIssuedAt(Math.floor(Date.now() / 1000) - 5).setExpirationTime("1h").sign(key(SECRET));
  check("a token verifies before revoke", (await auth.verify(old))?.id === "ada");
  await auth.revoke("ada");
  check("after revoke, a token issued before it is refused at once on the server that revoked", (await auth.verify(old)) === null);
  const again = await auth.signIn(fakeRes(), "ada");
  check("…and a sign-in straight after it is not", (await auth.verify(again))?.id === "ada");
  check("…on another server too, once it reads the store", (await createAuth({ store, jwt: { secret: SECRET } }).verify(old)) === null);
  check("other users are untouched", (await auth.verify(await auth.signIn(fakeRes(), "bob")))?.id === "bob");
  const noIat = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject("ada").setExpirationTime("1h").sign(key(SECRET));
  check("a revoked user's token with no iat is refused: it can't show it came after", (await auth.verify(noIat)) === null);
}

// ── the gate ────────────────────────────────────────────────────────────
console.log("\ngate");
{
  const auth = createAuth({ store: memoryAuthStore(), jwt: { secret: SECRET }, origins: ["https://admin.example.com"] });
  const token = await auth.signIn(fakeRes(), "ada");
  const exp = (await auth.verify(token)).claims.exp;
  const cookie = `theme=dark; __Host-haikit_token=${token}`;
  const json = { "content-type": "application/json; charset=utf-8" };
  const admit = (method, headers) => auth.gate.admit({ route: method === "GET" ? "events" : "chat", method, headers: { host: "app.example.com", ...headers } });
  const cases = {
    nothing: await admit("POST", { ...json }),
    invalid: await admit("POST", { ...json, cookie: "__Host-haikit_token=nope" }),
    empty: await admit("POST", { ...json, cookie: "__Host-haikit_token=" }),
    sameSite: await admit("POST", { ...json, cookie, origin: "https://app.example.com" }),
    noOrigin: await admit("POST", { ...json, cookie }),
    textPlain: await admit("POST", { "content-type": "text/plain", cookie, origin: "https://app.example.com" }),
    noType: await admit("POST", { cookie, origin: "https://app.example.com" }),
    crossSite: await admit("POST", { ...json, cookie, origin: "https://evil.example" }),
    nullOrigin: await admit("POST", { ...json, cookie, origin: "null" }),
    listed: await admit("POST", { ...json, cookie, origin: "https://admin.example.com" }),
    forwarded: await admit("POST", { ...json, cookie, host: "127.0.0.1:3000", origin: "https://app.example.com", "x-forwarded-host": "app.example.com" }),
    fetchSite: await admit("POST", { ...json, cookie, "sec-fetch-site": "cross-site" }),
    bearerElsewhere: await admit("POST", { ...json, authorization: `Bearer ${token}`, origin: "https://elsewhere.example" }),
    bearerFirst: await admit("POST", { ...json, authorization: "Bearer nope", cookie, origin: "https://app.example.com" }),
    events: await admit("GET", { cookie }),
  };
  check("no token: 401 sign in to continue", cases.nothing.ok === false && cases.nothing.status === 401 && cases.nothing.error === "sign in to continue");
  check("a bad token: 401, without saying why", cases.invalid.status === 401 && cases.invalid.error === "your sign-in has expired or is invalid");
  check("an empty cookie counts as none", cases.empty.status === 401 && cases.empty.error === "sign in to continue");
  check("a JSON POST from this site, with the cookie: admitted as its user, until its exp", cases.sameSite.ok && cases.sameSite.principal === "ada" && cases.sameSite.until === exp * 1000);
  check("…and one with no Origin, as a client that isn't a browser sends", cases.noOrigin.ok);
  check("a POST that isn't JSON: 415", [cases.textPlain, cases.noType].every((c) => c.status === 415 && c.error === "the request body must be sent as application/json"));
  check(
    "the cookie from another site, a null origin, or a cross-site fetch: 403",
    [cases.crossSite, cases.nullOrigin, cases.fetchSite].every((c) => c.status === 403 && c.error === "this request came from another site"),
  );
  check("an origin listed in origins, or matching x-forwarded-host, is this site", cases.listed.ok && cases.forwarded.ok);
  check("a Bearer token may come from another origin", cases.bearerElsewhere.ok && cases.bearerElsewhere.principal === "ada");
  check("a Bearer header is used before the cookie", cases.bearerFirst.status === 401);
  check("a GET needs no content type", cases.events.ok);

  await auth.gate.created("ada", "conv_1");
  check("created makes it the principal's", (await auth.ownerOf("conv_1")) === "ada");
  check("allows: its owner, and no one else", (await auth.gate.allows("ada", "conv_1")) && !(await auth.gate.allows("bob", "conv_1")) && !(await auth.gate.allows("ada", "conv_2")));
  check("a conversation can't change hands", await rejects(() => auth.claim("conv_1", "bob"), "conversation conv_1 already belongs to someone else"));
  await auth.claim("conv_old", "bob");
  check("claim adopts a conversation for a user", (await auth.ownerOf("conv_old")) === "bob");
  check("claim refuses an empty id", await rejects(() => auth.claim("", "bob"), "claim: conversationId must be a non-empty string"));

  // an owner made on another server is found here: unknown owners aren't kept
  const shared = memoryAuthStore();
  const a = createAuth({ store: shared, jwt: { secret: SECRET } });
  const b = createAuth({ store: shared, jwt: { secret: SECRET } });
  check("an unknown conversation has no owner", (await b.ownerOf("conv_9")) === null);
  await a.gate.created("ada", "conv_9");
  check("…until another server claims it, when this one finds it", (await b.ownerOf("conv_9")) === "ada");
}

// ── its routes ──────────────────────────────────────────────────────────
console.log("\nroutes");
{
  const auth = createAuth({ store: memoryAuthStore(), jwt: { secret: SECRET, ttlMs: 4_000 }, cookie: { secure: false } });
  const handle = auth.handler();
  const server = http.createServer(async (req, res) => (await handle(req, res)) || res.writeHead(404).end());
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const token = await auth.signIn(fakeRes(), "ada", { name: "Ada" });
    const cookie = `haikit_token=${token}`;
    const anon = await fetch(`${base}/auth/me`);
    check("GET /auth/me signed out: { user: null }, not cached", anon.status === 200 && (await anon.json()).user === null && anon.headers.get("cache-control") === "no-store");
    const me = await fetch(`${base}/auth/me`, { headers: { cookie } });
    const body = await me.json();
    check("GET /auth/me: the user and their claims", body.user?.id === "ada" && body.user.claims.name === "Ada" && !me.headers.get("set-cookie"));
    await wait(2_100); // past half of its 4 s
    const later = await fetch(`${base}/auth/me`, { headers: { cookie } });
    const renewed = later.headers.get("set-cookie") ?? "";
    const next = await auth.verify(tokenIn(renewed));
    check(
      "past half its life, /auth/me issues it again, with the same claims",
      renewed.startsWith("haikit_token=") && next?.id === "ada" && next.claims.name === "Ada" && next.claims.exp > (await auth.verify(token)).claims.exp,
    );
    const bearer = await fetch(`${base}/auth/me`, { headers: { authorization: `Bearer ${token}` } });
    check("…but not a Bearer token, which the page holds itself", !bearer.headers.get("set-cookie") && (await bearer.json()).user?.id === "ada");
    const out = await fetch(`${base}/auth/sign-out`, { method: "POST", headers: { origin: base } });
    check("POST /auth/sign-out: 204, clearing the cookie", out.status === 204 && out.headers.get("set-cookie") === "haikit_token=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax");
    const forced = await fetch(`${base}/auth/sign-out`, { method: "POST", headers: { origin: "https://evil.example" } });
    check("…but not from another site", forced.status === 403 && !forced.headers.get("set-cookie"));
    const others = await Promise.all([fetch(`${base}/auth/me`, { method: "POST" }), fetch(`${base}/auth/sign-out`), fetch(`${base}/auth/other`), fetch(`${base}/me`)]);
    check("anything else is left to the app", others.every((r) => r.status === 404));
  } finally {
    server.close();
  }
}

// ── in front of the real routes ─────────────────────────────────────────
console.log("\nwith nodeHandler");
{
  const { createHai, memoryStore, nodeHandler } = await import("../../server/dist/index.js");
  const { defineTool } = await import("../../core/dist/index.js");
  const auth = createAuth({ store: memoryAuthStore(), jwt: { secret: SECRET }, cookie: { secure: false } });
  const greet = defineTool({
    name: "greet",
    description: "Greet whoever this conversation belongs to.",
    input: { parse: (v) => v },
    inputJsonSchema: { type: "object", properties: {} },
    run: async (_input, ctx) => ctx.text(`hello ${await auth.ownerOf(ctx.conversationId)}`),
  });
  const hai = createHai({
    model: { id: "stub", async generate() { return { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" }; } },
    store: memoryStore(),
    tools: [],
    surfaces: [],
    system: "x",
    init: greet,
    updates: true,
  });
  const routes = nodeHandler(hai, "/hai", { gate: auth.gate });
  const server = http.createServer(async (req, res) => (await routes(req, res)) || res.writeHead(404).end());
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const as = async (user) => (user ? { cookie: `haikit_token=${await auth.signIn(fakeRes(), user)}` } : {});
  const post = async (path, body, user, extra = {}) =>
    fetch(`${base}/hai${path}`, { method: "POST", headers: { "content-type": "application/json", origin: base, ...(await as(user)), ...extra }, body: JSON.stringify(body) });
  const events = (text) => text.split("\n\n").map((f) => f.split("\n").find((l) => l.startsWith("data: "))).filter(Boolean).map((l) => JSON.parse(l.slice(6)));
  try {
    const anon = await post("/start", {});
    check("signed out, /start is a 401", anon.status === 401 && (await anon.json()).error === "sign in to continue");
    const started = await post("/start", {}, "ada");
    const got = events(await started.text());
    const id = got.find((e) => e.type === "hello")?.conversationId;
    const greeted = got.find((e) => e.type === "block_update")?.result;
    check("signed in, init runs, and its tool knows the user from ownerOf(ctx.conversationId)", greeted === "hello ada" && (await auth.ownerOf(id)) === "ada");
    const stranger = await post("/chat", { conversationId: id, message: "hi" }, "bob");
    check("another user is told it doesn't exist", stranger.status === 404);
    const owner = await post("/chat", { conversationId: id, message: "hi" }, "ada");
    const turn = events(await owner.text());
    check("…and its owner goes on", owner.status === 200 && turn.some((e) => e.type === "block_start" && e.block.kind === "user") && turn.some((e) => e.type === "context"));
    const cross = await post("/chat", { conversationId: id, message: "hi" }, "ada", { origin: "https://evil.example" });
    check("the owner's cookie from another site is a 403", cross.status === 403);
    const stream = await fetch(`${base}/hai/events?conversationId=${id}&poll=now`, { headers: await as("ada") });
    await stream.text();
    const peek = await fetch(`${base}/hai/events?conversationId=${id}&poll=now`, { headers: await as("bob") });
    check("its events: its owner's, and no one else's", stream.status === 200 && peek.status === 404);
  } finally {
    server.close();
  }
}

console.log(failures ? `\n${failures} check(s) failed\n` : "\nauth: all checks passed\n");
process.exit(failures ? 1 : 0);
