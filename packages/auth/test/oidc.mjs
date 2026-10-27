#!/usr/bin/env node
/**
 * @haikit/auth/oidc: signing in through a provider, against a stand-in for
 * one that runs in this process, reached through the providers' `fetch`.
 * What createAuth and oidc() refuse, the trip there and back, and every way
 * it can fail.
 *
 *   node packages/auth/test/oidc.mjs
 */

import http from "node:http";
import { createHash, hkdfSync } from "node:crypto";
import { EncryptJWT, SignJWT, decodeJwt, generateKeyPair } from "jose";
import { createAuth, memoryAuthStore } from "../dist/index.js";
import { google, oidc } from "../dist/oidc.js";

let failures = 0;
const check = (label, ok) => {
  console.log(`  ${ok ? "\x1b[32m✓" : "\x1b[31m✗"}\x1b[0m ${label}`);
  if (!ok) failures++;
};
const throws = (fn, message) => {
  try {
    fn();
    return false;
  } catch (err) {
    return err.message === message;
  }
};
/** What a function logs to console.error, kept from the test's output. */
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

const SECRET = "a-secret-for-tests-that-is-long-enough";
const OLD_SECRET = "the-secret-that-came-before-this-one!!";
const CLIENT = { clientId: "the-client", clientSecret: "the-client-secret" };
const REDIRECT = "http://localhost/auth/fake/callback";

// ── a provider, in this process ─────────────────────────────────────────

/**
 * Answers discovery for its issuer, and its token endpoint, as an OpenID
 * provider does; `authorize` stands in for the user signing in on its page.
 */
async function fakeProvider({
  issuer = "https://fake.test",
  authorize = `${issuer}/authorize`,
  token = `${issuer}/token`,
  methods = ["client_secret_basic", "client_secret_post"],
  // how this client is registered to prove itself
  accept = "client_secret_basic",
} = {}) {
  const { privateKey } = await generateKeyPair("RS256");
  const codes = new Map();
  const provider = {
    discoveries: 0,
    down: false,
    /** The next token response's ID token claims are changed by these. */
    tamper: {},
    /** The next token exchange waits for this promise. */
    hold: null,
    fetch: async (url, init = {}) => {
      if (provider.down) throw new TypeError("fetch failed");
      const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      if (url === `${issuer}/.well-known/openid-configuration`) {
        provider.discoveries++;
        return json(200, {
          issuer,
          authorization_endpoint: authorize,
          token_endpoint: token,
          jwks_uri: `${issuer}/jwks`,
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: methods,
        });
      }
      if (url === token && init.method === "POST") {
        const held = provider.hold;
        provider.hold = null;
        await held;
        const form = new URLSearchParams(String(init.body));
        // client_secret_basic: each half form-urlencoded, then base64 (RFC 6749 §2.3.1); client_secret_post: in the form
        const basic = new Headers(init.headers).get("authorization")?.match(/^Basic (.+)$/)?.[1];
        const [id, secret] =
          accept === "client_secret_post"
            ? [form.get("client_id"), form.get("client_secret")]
            : Buffer.from(basic ?? "", "base64").toString().split(":").map((s) => decodeURIComponent(s.replace(/\+/g, " ")));
        const grant = codes.get(form.get("code"));
        codes.delete(form.get("code"));
        if (id !== CLIENT.clientId || secret !== CLIENT.clientSecret) return json(401, { error: "invalid_client" });
        if (!grant || form.get("grant_type") !== "authorization_code" || form.get("redirect_uri") !== grant.redirectUri) return json(400, { error: "invalid_grant" });
        const challenge = createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
        if (challenge !== grant.challenge) return json(400, { error: "invalid_grant", error_description: "PKCE" });
        const now = Math.floor(Date.now() / 1000);
        const idToken = await new SignJWT({ nonce: grant.nonce, ...grant.claims, ...provider.tamper })
          .setProtectedHeader({ alg: "RS256" })
          .setIssuer(provider.tamper.iss ?? issuer)
          .setAudience(provider.tamper.aud ?? CLIENT.clientId)
          .setSubject(grant.sub)
          .setIssuedAt(now)
          .setExpirationTime(now + 3600)
          .sign(privateKey);
        provider.tamper = {};
        return json(200, { access_token: "at", token_type: "Bearer", expires_in: 3600, id_token: idToken });
      }
      return json(404, { error: "not_found" });
    },
    /** The user signs in at `location` as `sub`: where the provider sends their browser back. */
    signIn(location, sub = "1234", claims = { name: "Ada Lovelace", email: "ada@example.com", email_verified: true }) {
      const at = new URL(location);
      const code = `code-${codes.size}-${Math.random()}`;
      codes.set(code, {
        sub,
        claims,
        nonce: at.searchParams.get("nonce"),
        challenge: at.searchParams.get("code_challenge"),
        redirectUri: at.searchParams.get("redirect_uri"),
      });
      const back = new URL(at.searchParams.get("redirect_uri"));
      back.searchParams.set("code", code);
      back.searchParams.set("state", at.searchParams.get("state"));
      return back;
    },
    /** The user says no on its page. */
    deny(location) {
      const at = new URL(location);
      const back = new URL(at.searchParams.get("redirect_uri"));
      back.searchParams.set("error", "access_denied");
      back.searchParams.set("state", at.searchParams.get("state"));
      return back;
    },
  };
  return provider;
}

/** A server answering auth.handler("/auth"), and a browser with a cookie jar that follows nothing by itself. */
async function serve(auth) {
  const handle = auth.handler("/auth");
  const server = http.createServer(async (req, res) => (await handle(req, res)) || res.writeHead(404).end());
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = () => {
    const jar = new Map();
    return {
      jar,
      /** GET a path here, keeping the cookies it sets: its status, where it sends the browser, and the Set-Cookie lines. */
      async get(path) {
        const res = await fetch(base + path, {
          redirect: "manual",
          headers: { cookie: [...jar].map(([n, v]) => `${n}=${v}`).join("; ") },
        });
        const cookies = res.headers.getSetCookie();
        for (const line of cookies) {
          const [pair] = line.split(";");
          const at = pair.indexOf("=");
          const [name, value] = [pair.slice(0, at), pair.slice(at + 1)];
          if (/Max-Age=0\b/.test(line)) jar.delete(name);
          else jar.set(name, value);
        }
        await res.arrayBuffer();
        return { status: res.status, location: res.headers.get("location"), cookies };
      },
      /** The names of the flow cookies it holds, the earliest set first, as a browser sends them. */
      flows: () => [...jar.keys()].filter((name) => /^(__Host-)?haikit_sign_in-/.test(name)),
    };
  };
  return { server, browser };
}
/** The path and query a browser asks this server for, of a URL the provider sends it to. */
const pathOf = (url) => {
  const at = new URL(url);
  return at.pathname + at.search;
};

// ── createAuth and oidc() refuse what can't work ────────────────────────
console.log("\nrefusals");
{
  const fake = (over = {}) => oidc({ name: "fake", issuer: "https://fake.test", ...CLIENT, redirectUri: REDIRECT, ...over });
  const make = (providers, jwt = { secret: SECRET }) => () => createAuth({ store: memoryAuthStore(), jwt, providers });
  check("providers without jwt.secret", throws(make([fake()], { jwks: "https://idp.example/jwks" }), "createAuth: providers need jwt.secret: a sign-in through one ends in signIn"));
  const named = (name) => ({ name, redirectUri: `https://app.example/${name}/cb`, failureUrl: "/", start: async () => ({}), finish: async () => ({}) });
  for (const name of ["me", "sign-out", "Google", "", "a".repeat(33), "1st"]) {
    check(`a provider named ${JSON.stringify(name)}`, throws(make([named(name)]), `createAuth: "${name}" can't name a provider: 1 to 32 lowercase letters, digits or dashes, starting with a letter, and not me or sign-out`));
  }
  check("two providers of one name", throws(make([fake(), fake({ redirectUri: "http://localhost/other" })]), 'createAuth: two providers are named "fake"'));
  check(
    "two providers that come back to one path",
    throws(make([fake(), oidc({ name: "other", issuer: "https://other.test", ...CLIENT, redirectUri: REDIRECT })]), 'createAuth: providers "fake" and "other" both come back to /auth/fake/callback'),
  );
  for (const failureUrl of ["https://evil.example/", "//evil.example", "/\\evil.example", "sign-in", "/a\tb"]) {
    check(`a failureUrl of ${JSON.stringify(failureUrl)}`, throws(make([fake({ failureUrl })]), `createAuth: provider "fake"'s failureUrl must be a path on this site, such as /sign-in`));
  }
  check("an http issuer", throws(() => fake({ issuer: "http://fake.test" }), "oidc: issuer must be an https URL"));
  check("an issuer that isn't a URL", throws(() => fake({ issuer: "fake.test" }), "oidc: issuer must be a URL, such as https://accounts.google.com"));
  check("an empty clientId", throws(() => fake({ clientId: "" }), "oidc: clientId must be a non-empty string"));
  check("an empty clientSecret", throws(() => fake({ clientSecret: "" }), "oidc: clientSecret must be a non-empty string"));
  for (const redirectUri of ["http://app.example/cb", "https://app.example/cb#x", "ftp://localhost/cb"]) {
    check(`a redirectUri of ${redirectUri}`, throws(() => fake({ redirectUri }), "oidc: redirectUri must be https, or http on localhost, with no #fragment"));
  }
  check("a redirectUri that isn't a URL", throws(() => fake({ redirectUri: "/cb" }), "oidc: redirectUri must be a URL, such as https://app.example.com/auth/google/callback"));
  check("http on 127.0.0.1 is allowed", fake({ redirectUri: "http://127.0.0.1:5176/cb" }).redirectUri === "http://127.0.0.1:5176/cb");
  check("params that set the flow's own", throws(() => fake({ params: { state: "x" } }), "oidc: params can't set state: the sign-in sets it"));
  check("params that set max_age, which maxAgeMs sets and checks", throws(() => fake({ params: { max_age: "300" } }), "oidc: params can't set max_age: the sign-in sets it"));
  check("an unknown tokenEndpointAuthMethod", throws(() => fake({ tokenEndpointAuthMethod: "private_key_jwt" }), "oidc: tokenEndpointAuthMethod must be client_secret_basic or client_secret_post"));
  for (const maxAgeMs of [-1, NaN, Infinity]) {
    check(`a maxAgeMs of ${maxAgeMs}`, throws(() => fake({ maxAgeMs }), "oidc: maxAgeMs must be a finite number, at least 0"));
  }
  check(
    "a cookie.name a flow cookie's might have",
    throws(
      () => createAuth({ store: memoryAuthStore(), jwt: { secret: SECRET }, cookie: { name: "__Host-haikit_sign_in-x" }, providers: [fake()] }),
      "createAuth: cookie.name can't start with __Host-haikit_sign_in-: sign-ins through a provider keep their cookies under those names",
    ),
  );
  check("…which is fine with no providers", typeof createAuth({ store: memoryAuthStore(), jwt: { secret: SECRET }, cookie: { name: "__Host-haikit_sign_in-x" } }).gate === "object");
  check("a bad name", throws(() => fake({ name: "Fake" }), "oidc: name must be 1 to 32 lowercase letters, digits or dashes, starting with a letter"));
  check("google: an empty hostedDomain", throws(() => google({ ...CLIENT, redirectUri: REDIRECT, hostedDomain: "" }), "google: hostedDomain must be a domain, such as example.com"));
}

// ── there and back ──────────────────────────────────────────────────────
console.log("\nthere and back");
{
  const idp = await fakeProvider();
  const auth = createAuth({
    store: memoryAuthStore(),
    jwt: { secret: SECRET },
    cookie: { secure: false },
    providers: [oidc({ name: "fake", issuer: "https://fake.test", ...CLIENT, redirectUri: REDIRECT, failureUrl: "/sign-in", fetch: idp.fetch })],
  });
  const { server, browser } = await serve(auth);
  try {
    const b = browser();
    const started = await b.get("/auth/fake?return_to=/chats/7%3Fx=1");
    const to = new URL(started.location);
    const flowLine = started.cookies.find((c) => c.startsWith("haikit_sign_in-"));
    check("start: a 303 to the provider's sign-in page", started.status === 303 && to.origin + to.pathname === "https://fake.test/authorize");
    const p = Object.fromEntries(to.searchParams);
    check(
      "…with the client, the redirect, a code, the scopes, state, nonce and an S256 challenge",
      p.client_id === "the-client" &&
        p.redirect_uri === REDIRECT &&
        p.response_type === "code" &&
        p.scope === "openid email profile" &&
        p.state?.length >= 32 &&
        p.nonce?.length >= 32 &&
        p.code_challenge_method === "S256" &&
        /^[\w-]{43}$/.test(p.code_challenge),
    );
    check("…and the flow in a cookie of its own: HttpOnly, Lax, 10 minutes", /^haikit_sign_in-[\w-]{8}=[^;]+; Max-Age=600; Path=\/; HttpOnly; SameSite=Lax$/.test(flowLine ?? ""));
    check("…sealed: nothing in it can be read", !flowLine.includes(p.state) && flowLine.split(".").length === 5);
    check("the provider's settings were read once", idp.discoveries === 1);

    const back = await b.get(pathOf(idp.signIn(started.location)));
    const token = b.jar.get("haikit_token");
    const claims = token && decodeJwt(token);
    check("back: a 303 to return_to", back.status === 303 && back.location === "/chats/7?x=1");
    check("…signed in as {name}:{sub}, with the name and the verified email", claims?.sub === "fake:1234" && claims.name === "Ada Lovelace" && claims.email === "ada@example.com");
    check("…and the flow cookie is cleared", !b.flows().length && back.cookies.some((c) => c.startsWith(`${flowLine.split("=")[0]}=; Max-Age=0;`)));
    check("…the user is who the gate admits", (await auth.verify(token))?.id === "fake:1234");

    const again = await b.get("/auth/fake");
    await b.get(pathOf(idp.signIn(again.location, "5678", { name: "Bob", email: "bob@example.com", email_verified: false })));
    const bob = decodeJwt(b.jar.get("haikit_token"));
    check("an unverified email isn't passed on", bob.sub === "fake:5678" && bob.name === "Bob" && !("email" in bob));
    check("the settings are kept: read once still", idp.discoveries === 1);

    for (const returnTo of ["//evil.example", "https://evil.example", "/\\evil.example", "/%09/evil.example".replace("%09", "\t"), "/" + "a".repeat(2_048)]) {
      const c = browser();
      const s = await c.get(`/auth/fake?return_to=${encodeURIComponent(returnTo)}`);
      const done = await c.get(pathOf(idp.signIn(s.location)));
      check(`return_to ${JSON.stringify(returnTo.slice(0, 20))}${returnTo.length > 20 ? "…" : ""} goes to /`, done.location === "/");
    }
    const longest = browser();
    const ok = "/" + "a".repeat(2_047);
    const s = await longest.get(`/auth/fake?return_to=${ok}`);
    check("a return_to of 2,048 characters is kept", (await longest.get(pathOf(idp.signIn(s.location)))).location === ok);
  } finally {
    server.close();
  }
}

// ── and every way it can fail ───────────────────────────────────────────
console.log("\nfailures");
{
  const idp = await fakeProvider();
  let hook = undefined;
  const auth = createAuth({
    store: memoryAuthStore(),
    jwt: { secret: SECRET },
    providers: [
      oidc({ name: "fake", issuer: "https://fake.test", ...CLIENT, redirectUri: REDIRECT, failureUrl: "/sign-in?from=fake", fetch: idp.fetch, user: (profile) => (hook ? hook(profile) : `fake:${profile.sub}`) }),
      oidc({ name: "other", issuer: "https://fake.test", ...CLIENT, redirectUri: "http://localhost/auth/other/callback", fetch: idp.fetch }),
    ],
  });
  const { server, browser } = await serve(auth);
  const why = (r) => r.status === 303 && new URL(r.location, "http://x").searchParams.get("sign_in_error");
  try {
    let b = browser();
    let s = await b.get("/auth/fake");
    check("a secure flow cookie is __Host-haikit_sign_in-{id}, and Secure", s.cookies.some((c) => /^__Host-haikit_sign_in-[\w-]{8}=[^;]+; Max-Age=600; Path=\/; HttpOnly; SameSite=Lax; Secure$/.test(c)));
    let r = await b.get(pathOf(idp.deny(s.location)));
    check("the user says no: access_denied, at the failureUrl", why(r) === "access_denied" && r.location === "/sign-in?from=fake&sign_in_error=access_denied");
    check("…and no one is signed in", !b.jar.has("__Host-haikit_token") && !b.flows().length);

    b = browser();
    s = await b.get("/auth/fake");
    const callback = idp.signIn(s.location);
    r = await browser().get(pathOf(callback));
    check("no flow cookie: expired", why(r) === "expired" && !r.cookies.length);
    // the first character of the ciphertext: every bit of it counts
    const [sealed] = b.flows();
    const parts = b.jar.get(sealed).split(".");
    parts[3] = (parts[3][0] === "A" ? "B" : "A") + parts[3].slice(1);
    b.jar.set(sealed, parts.join("."));
    r = await b.get(pathOf(callback));
    check("a flow cookie changed by a byte: expired, and left to its Max-Age", why(r) === "expired" && !r.cookies.length && !b.jar.has("__Host-haikit_token"));

    b = browser();
    const first = await b.get("/auth/fake");
    const second = await b.get("/auth/fake"); // another tab, started since
    const [early, late] = b.flows();
    r = await b.get(pathOf(idp.signIn(first.location)));
    check("two tabs: the earlier one's way back signs in", r.location === "/" && b.jar.has("__Host-haikit_token"));
    check("…clearing its own flow cookie, and not the other's", r.cookies.some((c) => c.startsWith(`${early}=; Max-Age=0;`)) && b.flows().join() === late);
    r = await b.get(pathOf(idp.signIn(second.location)));
    check("…so the later one signs in too", r.location === "/" && !b.flows().length);
    r = await b.get(pathOf(idp.signIn(first.location)));
    check("…and a way back to a sign-in that's over: expired", why(r) === "expired");

    // tab A back, its code exchanged slowly; meanwhile tab B starts
    b = browser();
    const a = await b.get("/auth/fake");
    let release;
    idp.hold = new Promise((r) => (release = r));
    const aBack = b.get(pathOf(idp.signIn(a.location)));
    const bStart = await b.get("/auth/fake");
    release();
    r = await aBack;
    check("a way back that ends after another tab started: signed in", r.location === "/" && b.jar.has("__Host-haikit_token"));
    check("…and the newer tab's flow cookie is still there", b.flows().length === 1);
    b.jar.delete("__Host-haikit_token");
    r = await b.get(pathOf(idp.signIn(bStart.location, "5678")));
    check("…so the newer tab signs in when it comes back", r.location === "/" && decodeJwt(b.jar.get("__Host-haikit_token")).sub === "fake:5678");

    b = browser();
    s = await b.get("/auth/other");
    r = await b.get(pathOf(idp.signIn(s.location)).replace("/auth/other/", "/auth/fake/"));
    check("a flow cookie for another provider: expired, and kept for it", why(r) === "expired" && b.flows().length === 1 && !r.cookies.length);

    // sealed as the server seals one, by the documented derivation, but ten minutes ago
    const key = new Uint8Array(hkdfSync("sha256", new TextEncoder().encode(SECRET), new Uint8Array(0), "haikit/auth sign-in flow", 32));
    b = browser();
    s = await b.get("/auth/fake");
    const state = new URL(s.location).searchParams.get("state");
    const stale = await new EncryptJWT({ p: "fake", f: { state, nonce: "n", verifier: "v" }, r: "/" })
      .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
      .setExpirationTime(Math.floor(Date.now() / 1000) - 1)
      .encrypt(key);
    b.jar.set(b.flows()[0], stale);
    r = await b.get(pathOf(idp.signIn(s.location)));
    check("a flow cookie past its 10 minutes: expired", why(r) === "expired");

    const fails = async (label, tamper) => {
      const c = browser();
      const started = await c.get("/auth/fake");
      idp.tamper = tamper;
      let answer;
      const logged = await quietly(async () => (answer = await c.get(pathOf(idp.signIn(started.location)))));
      check(`${label}: failed, logged, and nothing said to the browser`, why(answer) === "failed" && logged.some((l) => l.startsWith("[haikit] auth: a sign-in with fake failed:")) && !c.jar.has("__Host-haikit_token"));
    };
    await fails("an ID token with another nonce", { nonce: "someone-elses" });
    await fails("an ID token for another client", { aud: "another-client" });
    await fails("an ID token from another issuer", { iss: "https://evil.test" });
    {
      const c = browser();
      const started = await c.get("/auth/fake");
      const at = new URL(started.location);
      at.searchParams.set("code_challenge", "A".repeat(43)); // a challenge this browser's verifier doesn't answer
      let answer;
      const logged = await quietly(async () => (answer = await c.get(pathOf(idp.signIn(at.href)))));
      check("a verifier that doesn't answer the challenge (PKCE): failed, logged", why(answer) === "failed" && logged.length === 1);
    }
    {
      const c = browser();
      const started = await c.get("/auth/fake");
      idp.down = true;
      let answer;
      const logged = await quietly(async () => (answer = await c.get(pathOf(idp.signIn(started.location)))));
      idp.down = false;
      check("the token endpoint down: failed, logged", why(answer) === "failed" && logged.length === 1);
    }

    const as = async (fn) => {
      hook = fn;
      const c = browser();
      const started = await c.get("/auth/fake");
      let answer;
      const logged = await quietly(async () => (answer = await c.get(pathOf(idp.signIn(started.location)))));
      hook = undefined;
      return { answer, logged, claims: c.jar.has("__Host-haikit_token") ? decodeJwt(c.jar.get("__Host-haikit_token")) : null };
    };
    let got = await as(() => null);
    check("user returns null: refused", why(got.answer) === "refused" && got.claims === null && got.logged.length === 0);
    got = await as(() => {
      throw new Error("the users table is down");
    });
    check("user throws: failed, logged", why(got.answer) === "failed" && got.logged.some((l) => l.includes("the users table is down")));
    got = await as(({ sub }) => `user-${sub}`);
    check("user returns a string: that id, with the default claims", got.claims?.sub === "user-1234" && got.claims.name === "Ada Lovelace" && got.claims.email === "ada@example.com");
    got = await as(({ sub }) => ({ userId: `u${sub}`, claims: { role: "admin" } }));
    check("user returns { userId, claims }: exactly those", got.claims?.sub === "u1234" && got.claims.role === "admin" && !("name" in got.claims));
    got = await as(() => ({ userId: "x", claims: { exp: 1 } }));
    check("claims signIn sets itself: failed, logged", why(got.answer) === "failed" && got.logged.some((l) => l.includes('"exp" is set by signIn')));
  } finally {
    server.close();
  }
}

// ── the provider's settings, unreachable ────────────────────────────────
console.log("\nsettings");
{
  const idp = await fakeProvider();
  const auth = createAuth({
    store: memoryAuthStore(),
    jwt: { secret: SECRET },
    providers: [oidc({ name: "fake", issuer: "https://fake.test", ...CLIENT, redirectUri: REDIRECT, fetch: idp.fetch })],
  });
  const { server, browser } = await serve(auth);
  try {
    idp.down = true;
    let r;
    const logged = await quietly(async () => (r = await browser().get("/auth/fake")));
    check("unreachable: a 303 to the failureUrl with failed, logged", r.status === 303 && r.location === "/?sign_in_error=failed" && logged.some((l) => l.startsWith("[haikit] auth: a sign-in with fake couldn't start:")));
    check("…and no flow cookie", r.cookies.length === 0);
    idp.down = false;
    r = await browser().get("/auth/fake");
    check("read again on the next sign-in", r.status === 303 && r.location.startsWith("https://fake.test/authorize") && idp.discoveries === 1);
    const plain = await fakeProvider({ issuer: "https://plain.test", authorize: "http://plain.test/authorize" });
    const downgraded = createAuth({
      store: memoryAuthStore(),
      jwt: { secret: SECRET },
      providers: [oidc({ name: "plain", issuer: "https://plain.test", ...CLIENT, redirectUri: "http://localhost/auth/plain/callback", fetch: plain.fetch })],
    });
    const there = await serve(downgraded);
    try {
      let answer;
      const said = await quietly(async () => (answer = await there.browser().get("/auth/plain")));
      check(
        "an https issuer whose sign-in page is plain http: failed, never sent there",
        answer.location === "/?sign_in_error=failed" && said.some((l) => l.includes("oidc: https://plain.test/'s authorization_endpoint isn't https")),
      );
    } finally {
      there.server.close();
    }
    check("the routes answer GET only", (await fetch(`http://127.0.0.1:${server.address().port}/auth/fake`, { method: "POST" })).status === 404);
    check("an unknown provider isn't a route", (await browser().get("/auth/nobody")).status === 404);
  } finally {
    server.close();
  }
}

// ── how the client proves itself, and how recent a sign-in must be ──────
console.log("\nclient authentication and max age");
{
  /** Signs in through a provider made with these, and says how it ended. */
  const trip = async (idp, over, claims) => {
    const auth = createAuth({
      store: memoryAuthStore(),
      jwt: { secret: SECRET },
      providers: [oidc({ name: "fake", issuer: "https://fake.test", ...CLIENT, redirectUri: REDIRECT, fetch: idp.fetch, ...over })],
    });
    const { server, browser } = await serve(auth);
    try {
      const b = browser();
      const s = await b.get("/auth/fake");
      let r;
      await quietly(async () => (r = await b.get(pathOf(idp.signIn(s.location, "1234", claims)))));
      return { start: new URL(s.location), location: r.location };
    } finally {
      server.close();
    }
  };
  const postOnly = await fakeProvider({ accept: "client_secret_post" });
  check("a client registered for client_secret_post, at a provider that offers both: Basic by default, refused", (await trip(postOnly, {})).location === "/?sign_in_error=failed");
  check("…and with tokenEndpointAuthMethod: client_secret_post, signed in", (await trip(postOnly, { tokenEndpointAuthMethod: "client_secret_post" })).location === "/");
  const offersPost = await fakeProvider({ methods: ["client_secret_post"], accept: "client_secret_post" });
  check("a provider that offers only client_secret_post gets it by default", (await trip(offersPost, {})).location === "/");

  const idp = await fakeProvider();
  const now = Math.floor(Date.now() / 1000);
  let t = await trip(idp, { maxAgeMs: 300_000 }, { name: "Ada", auth_time: now - 10 });
  check("maxAgeMs: sent as max_age, in seconds", t.start.searchParams.get("max_age") === "300");
  check("…a sign-in at the provider 10 s ago is accepted", t.location === "/");
  t = await trip(idp, { maxAgeMs: 300_000 }, { name: "Ada", auth_time: now - 3_600 });
  check("…one an hour ago is refused: failed", t.location === "/?sign_in_error=failed");
  t = await trip(idp, { maxAgeMs: 300_000 }, { name: "Ada" });
  check("…and one that doesn't say when: failed", t.location === "/?sign_in_error=failed");
  t = await trip(idp, {}, { name: "Ada" });
  check("without maxAgeMs, no max_age, and no auth_time needed", !t.start.searchParams.has("max_age") && t.location === "/");
}

// ── what a Location, a cookie and the routes can hold ───────────────────
console.log("\nedges");
{
  const idp = await fakeProvider();
  /** A provider of the app's own: start as given, and back as ada. */
  const custom = (name, over = {}) => ({
    name,
    redirectUri: `http://localhost/auth/${name}/callback`,
    failureUrl: "/",
    start: async () => ({ url: new URL("https://custom.test/"), flow: {} }),
    finish: async () => ({ userId: "ada" }),
    ...over,
  });
  const auth = createAuth({
    store: memoryAuthStore(),
    jwt: { secret: SECRET },
    providers: [
      oidc({ name: "fake", issuer: "https://fake.test", ...CLIENT, redirectUri: REDIRECT, fetch: idp.fetch }),
      custom("dotted", { failureUrl: "/a/..//evil.example", start: async () => Promise.reject(new Error("down")) }),
      custom("unicode", { failureUrl: "/登录?from=x#top", start: async () => Promise.reject(new Error("down")) }),
      custom("huge", { start: async () => ({ url: new URL("https://custom.test/"), flow: { big: "x".repeat(5_000) } }) }),
    ],
  });
  const { server, browser } = await serve(auth);
  try {
    let b = browser();
    let s = await b.get(`/auth/fake?return_to=${encodeURIComponent('/日本語?q=ä b&x="y"')}`);
    let r = await b.get(pathOf(idp.signIn(s.location)));
    check("a return_to beyond ASCII is percent-encoded for the Location, and the sign-in completes", r.status === 303 && r.location === "/%E6%97%A5%E6%9C%AC%E8%AA%9E?q=%C3%A4%20b&x=%22y%22" && b.jar.has("__Host-haikit_token"));
    b = browser();
    s = await b.get(`/auth/fake?return_to=${encodeURIComponent("/%E6%97%A5")}`);
    r = await b.get(pathOf(idp.signIn(s.location)));
    check("…and an escape already there is kept as it is", r.location === "/%E6%97%A5");
    b = browser();
    s = await b.get(`/auth/fake?return_to=${encodeURIComponent("/" + '"'.repeat(2_047))}`);
    check("a return_to past 2,048 characters once encoded goes to /, and its cookie fits", s.cookies.every((c) => Buffer.byteLength(c.split(";")[0]) <= 4_096));
    r = await b.get(pathOf(idp.signIn(s.location)));
    check("…and the sign-in completes", r.location === "/" && b.jar.has("__Host-haikit_token"));

    b = browser();
    for (let i = 0; i < 3; i++) await b.get("/auth/fake");
    check("three sign-ins on their way at once keep a cookie each", b.flows().length === 3);
    b = browser();
    const long = "/" + "a".repeat(1_500);
    const one = await b.get(`/auth/fake?return_to=${long}`);
    const [oneName] = b.flows();
    const two = await b.get(`/auth/fake?return_to=${long}`);
    const together = b.flows().reduce((n, name) => n + Buffer.byteLength(`${name}=${b.jar.get(name)}`), 0);
    check("two that don't fit in 4,096 bytes together: the earlier one is cleared", two.cookies.some((c) => c.startsWith(`${oneName}=; Max-Age=0;`)) && b.flows().length === 1 && together <= 4_096);
    r = await b.get(pathOf(idp.signIn(one.location)));
    check("…so its way back is expired", r.location === "/?sign_in_error=expired");
    r = await b.get(pathOf(idp.signIn(two.location)));
    check("…and the later one signs in", r.location === long);

    let logged = await quietly(async () => (r = await browser().get("/auth/huge")));
    check("a flow too large for a cookie: failed, logged, and no cookie", r.location === "/?sign_in_error=failed" && r.cookies.length === 0 && logged.some((l) => l.includes("its flow is too large for a cookie")));
    logged = await quietly(async () => (r = await browser().get("/auth/dotted")));
    check("a failureUrl with dot segments is sent as configured, never as //another-host", r.location === "/a/..//evil.example?sign_in_error=failed");
    logged = await quietly(async () => (r = await browser().get("/auth/unicode")));
    check("a failureUrl beyond ASCII is percent-encoded, its query and fragment kept", r.location === "/%E7%99%BB%E5%BD%95?from=x&sign_in_error=failed#top");
  } finally {
    server.close();
  }

  const on = (path) => createAuth({ store: memoryAuthStore(), jwt: { secret: SECRET }, providers: [custom("one"), custom("two", { redirectUri: `http://localhost${path}` })] });
  for (const path of ["/auth/one", "/auth/me", "/auth/sign-out"]) {
    check(`a redirectUri that comes back to ${path}`, throws(() => on(path).handler("/auth"), `auth.handler: provider "two"'s redirectUri comes back to ${path}, a route the handler answers already`));
  }
  check("…which is fine under another basePath", typeof on("/auth/me").handler("/account") === "function");
}

// ── rotation ────────────────────────────────────────────────────────────
console.log("\nrotation");
{
  const idp = await fakeProvider();
  const make = (secret) =>
    createAuth({ store: memoryAuthStore(), jwt: { secret }, providers: [oidc({ name: "fake", issuer: "https://fake.test", ...CLIENT, redirectUri: REDIRECT, fetch: idp.fetch })] });
  const before = await serve(make(OLD_SECRET));
  const after = await serve(make([SECRET, OLD_SECRET]));
  try {
    const b = before.browser();
    const s = await b.get("/auth/fake");
    const a = after.browser();
    for (const name of b.flows()) a.jar.set(name, b.jar.get(name));
    const r = await a.get(pathOf(idp.signIn(s.location)));
    check("a flow begun under the old secret ends under the new ones", r.status === 303 && r.location === "/" && a.jar.has("__Host-haikit_token"));
  } finally {
    before.server.close();
    after.server.close();
  }
}

// ── google() ────────────────────────────────────────────────────────────
console.log("\ngoogle");
{
  const idp = await fakeProvider({
    issuer: "https://accounts.google.com",
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
  });
  let asked = 0;
  const auth = createAuth({
    store: memoryAuthStore(),
    jwt: { secret: SECRET },
    providers: [
      google({
        ...CLIENT,
        redirectUri: "http://localhost:5176/auth/google/callback",
        hostedDomain: "example.com",
        fetch: idp.fetch,
        user: (profile) => (asked++, `${profile.provider}:${profile.sub}`),
      }),
    ],
  });
  const plain = google({ ...CLIENT, redirectUri: REDIRECT, prompt: "", params: { login_hint: "ada@example.com" }, fetch: idp.fetch });
  const { server, browser } = await serve(auth);
  try {
    check("named google", plain.name === "google");
    let b = browser();
    let s = await b.get("/auth/google");
    const p = new URL(s.location).searchParams;
    check("start: Google's sign-in page, asking which account, offering the domain's", s.location.startsWith("https://accounts.google.com/o/oauth2/v2/auth?") && p.get("prompt") === "select_account" && p.get("hd") === "example.com");
    const { url } = await plain.start();
    check("prompt: \"\" sends none, and params pass through", !url.searchParams.has("prompt") && !url.searchParams.has("hd") && url.searchParams.get("login_hint") === "ada@example.com");
    let r = await b.get(pathOf(idp.signIn(s.location, "42", { name: "Ada", hd: "example.com", email: "ada@example.com", email_verified: true })));
    check("an account of the domain signs in, as google:{sub}", r.location === "/" && decodeJwt(b.jar.get("__Host-haikit_token")).sub === "google:42" && asked === 1);
    b = browser();
    s = await b.get("/auth/google");
    r = await b.get(pathOf(idp.signIn(s.location, "43", { name: "Eve", email: "eve@gmail.com", email_verified: true })));
    check("an account of no domain: refused, before the app's user is asked", r.location === "/?sign_in_error=refused" && asked === 1);
    b = browser();
    s = await b.get("/auth/google");
    r = await b.get(pathOf(idp.signIn(s.location, "44", { name: "Mallory", hd: "evil.example" })));
    check("…or another domain's: refused", r.location === "/?sign_in_error=refused" && asked === 1);
  } finally {
    server.close();
  }
}

console.log(failures ? `\n${failures} check(s) failed\n` : "\noidc: all checks passed\n");
process.exit(failures ? 1 : 0);
