#!/usr/bin/env node
/**
 * @haikit/auth/oauth2: signing in through a provider with no OpenID
 * Connect, against a stand-in for one that runs in this process, reached
 * through the provider's `fetch`: its sign-in page, its token endpoint, and
 * an API that answers only to its access tokens. What oauth2() refuses, the
 * trip there and back, every way it can fail, `api.get`, and github().
 *
 *   node packages/auth/test/oauth2.mjs
 */

import http from "node:http";
import { createHash } from "node:crypto";
import { decodeJwt } from "jose";
import { createAuth, memoryAuthStore } from "../dist/index.js";
import { github, oauth2 } from "../dist/oauth2.js";

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
const CLIENT = { clientId: "the-client", clientSecret: "the-client-secret" };
const REDIRECT = "http://localhost/auth/fake/callback";
const ENDPOINTS = { authorizationEndpoint: "https://fake.test/authorize", tokenEndpoint: "https://fake.test/token" };
const ADA = { id: 1234, name: "Ada Lovelace", email: "ada@example.com", email_verified: true };
/** Reads the user from the stand-in's API, as an app's profile would. */
const me = async (api) => {
  const user = await api.get("https://fake.test/api/me");
  return { sub: String(user.id), claims: user };
};

// ── a provider, in this process ─────────────────────────────────────────

/**
 * Answers its token endpoint as an OAuth 2.0 provider does, and `routes`, its
 * API, for a request whose Bearer token it issued; `signIn` stands in for the
 * user signing in on its page.
 */
function fakeProvider({
  authorize = ENDPOINTS.authorizationEndpoint,
  token = ENDPOINTS.tokenEndpoint,
  // how this client is registered to prove itself
  accept = "client_secret_basic",
  // GitHub answers a code it doesn't know 200, with the error in the body
  errorStatus = 400,
  routes = { "https://fake.test/api/me": (user, json) => json(200, user) },
} = {}) {
  const codes = new Map();
  const tokens = new Map();
  const provider = {
    down: false,
    /** The next token exchange waits for this promise. */
    hold: null,
    /** The API requests made, with their headers. */
    requests: [],
    fetch: async (url, init = {}) => {
      if (provider.down) throw new TypeError("fetch failed");
      const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
      if (url === token && init.method === "POST") {
        const held = provider.hold;
        provider.hold = null;
        await held;
        const form = new URLSearchParams(String(init.body));
        const basic = new Headers(init.headers).get("authorization")?.match(/^Basic (.+)$/)?.[1];
        const [id, secret] =
          accept === "client_secret_post"
            ? [form.get("client_id"), form.get("client_secret")]
            : Buffer.from(basic ?? "", "base64").toString().split(":").map((s) => decodeURIComponent(s.replace(/\+/g, " ")));
        const grant = codes.get(form.get("code"));
        codes.delete(form.get("code"));
        if (id !== CLIENT.clientId || secret !== CLIENT.clientSecret) return json(errorStatus === 200 ? 200 : 401, { error: "invalid_client" });
        if (!grant || form.get("grant_type") !== "authorization_code" || form.get("redirect_uri") !== grant.redirectUri) {
          return json(errorStatus, { error: errorStatus === 200 ? "bad_verification_code" : "invalid_grant" });
        }
        const challenge = createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
        if (challenge !== grant.challenge) return json(errorStatus, { error: "invalid_grant", error_description: "PKCE" });
        const accessToken = `at-${Math.random()}`;
        tokens.set(accessToken, grant.user);
        return json(200, { access_token: accessToken, token_type: "bearer", scope: grant.scope ?? "" });
      }
      const at = new URL(url);
      const route = routes[at.origin + at.pathname];
      if (route) {
        const headers = new Headers(init.headers);
        provider.requests.push({ url, headers, redirect: init.redirect });
        const user = tokens.get(headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1]);
        if (!user) return json(401, { message: "Bad credentials" });
        return route(user, json);
      }
      return json(404, { error: "not_found" });
    },
    /** The user signs in at `location` as `user`: where the provider sends their browser back. */
    signIn(location, user = ADA) {
      const at = new URL(location);
      const code = `code-${codes.size}-${Math.random()}`;
      codes.set(code, {
        user,
        scope: at.searchParams.get("scope"),
        challenge: at.searchParams.get("code_challenge"),
        redirectUri: at.searchParams.get("redirect_uri"),
      });
      const back = new URL(at.searchParams.get("redirect_uri"));
      back.searchParams.set("code", code);
      back.searchParams.set("state", at.searchParams.get("state"));
      return back;
    },
    /** The user says no on its page, or it answers with another error. */
    deny(location, error = "access_denied") {
      const at = new URL(location);
      const back = new URL(at.searchParams.get("redirect_uri"));
      back.searchParams.set("error", error);
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
      /** The names of the flow cookies it holds. */
      flows: () => [...jar.keys()].filter((name) => /^(__Host-)?haikit_sign_in-/.test(name)),
      /** The claims of the token it's signed in with, or null. */
      claims: () => {
        const token = jar.get("__Host-haikit_token") ?? jar.get("haikit_token");
        return token ? decodeJwt(token) : null;
      },
    };
  };
  return { server, browser };
}
/** The path and query a browser asks this server for, of a URL the provider sends it to. */
const pathOf = (url) => {
  const at = new URL(url);
  return at.pathname + at.search;
};
const why = (r) => r.status === 303 && new URL(r.location, "http://x").searchParams.get("sign_in_error");

// ── oauth2() refuses what can't work ────────────────────────────────────
console.log("\nrefusals");
{
  const fake = (over = {}) => oauth2({ name: "fake", ...ENDPOINTS, ...CLIENT, redirectUri: REDIRECT, profile: me, ...over });
  check("a bad name", throws(() => fake({ name: "Fake" }), "oauth2: name must be 1 to 32 lowercase letters, digits or dashes, starting with a letter"));
  check(
    "an authorizationEndpoint that isn't a URL",
    throws(() => fake({ authorizationEndpoint: "github.com/login/oauth/authorize" }), "oauth2: authorizationEndpoint must be a URL, such as https://github.com/login/oauth/authorize"),
  );
  check("an http authorizationEndpoint", throws(() => fake({ authorizationEndpoint: "http://fake.test/authorize" }), "oauth2: authorizationEndpoint must be an https URL"));
  check("a tokenEndpoint that isn't a URL", throws(() => fake({ tokenEndpoint: "/token" }), "oauth2: tokenEndpoint must be a URL, such as https://github.com/login/oauth/access_token"));
  check("an http tokenEndpoint", throws(() => fake({ tokenEndpoint: "http://fake.test/token" }), "oauth2: tokenEndpoint must be an https URL"));
  check("an empty clientId", throws(() => fake({ clientId: "" }), "oauth2: clientId must be a non-empty string"));
  check("an empty clientSecret", throws(() => fake({ clientSecret: "" }), "oauth2: clientSecret must be a non-empty string"));
  for (const redirectUri of ["http://app.example/cb", "https://app.example/cb#x", "ftp://localhost/cb"]) {
    check(`a redirectUri of ${redirectUri}`, throws(() => fake({ redirectUri }), "oauth2: redirectUri must be https, or http on localhost, with no #fragment"));
  }
  check("a redirectUri that isn't a URL", throws(() => fake({ redirectUri: "/cb" }), "oauth2: redirectUri must be a URL, such as https://app.example.com/auth/github/callback"));
  check("http on [::1] is allowed", fake({ redirectUri: "http://[::1]:5176/cb" }).redirectUri === "http://[::1]:5176/cb");
  for (const param of ["client_id", "redirect_uri", "response_type", "response_mode", "scope", "state", "code_challenge", "code_challenge_method"]) {
    check(`params that set ${param}`, throws(() => fake({ params: { [param]: "x" } }), `oauth2: params can't set ${param}: the sign-in sets it`));
  }
  check("…but params may set what OpenID Connect would, such as nonce", fake({ params: { nonce: "x" } }).name === "fake");
  check("an unknown tokenEndpointAuthMethod", throws(() => fake({ tokenEndpointAuthMethod: "private_key_jwt" }), "oauth2: tokenEndpointAuthMethod must be client_secret_basic or client_secret_post"));
  check("no profile", throws(() => fake({ profile: undefined }), "oauth2: profile must be a function: with no ID token, it's what says who signed in"));
  check("github: what oauth2 refuses", throws(() => github({ ...CLIENT, redirectUri: "http://app.example/cb" }), "oauth2: redirectUri must be https, or http on localhost, with no #fragment"));
  check(
    "createAuth: a provider's failureUrl that isn't a path here",
    throws(() => createAuth({ store: memoryAuthStore(), jwt: { secret: SECRET }, providers: [fake({ failureUrl: "//evil.example" })] }), `createAuth: provider "fake"'s failureUrl must be a path on this site, such as /sign-in`),
  );
}

// ── there and back ──────────────────────────────────────────────────────
console.log("\nthere and back");
{
  const idp = fakeProvider();
  const auth = createAuth({
    store: memoryAuthStore(),
    jwt: { secret: SECRET },
    cookie: { secure: false },
    providers: [oauth2({ name: "fake", ...ENDPOINTS, ...CLIENT, redirectUri: REDIRECT, scopes: ["read", "email", "read"], failureUrl: "/sign-in", profile: me, fetch: idp.fetch })],
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
      "…with the client, the redirect, a code, the scopes once each, state and an S256 challenge",
      p.client_id === "the-client" &&
        p.redirect_uri === REDIRECT &&
        p.response_type === "code" &&
        p.scope === "read email" &&
        p.state?.length >= 32 &&
        p.code_challenge_method === "S256" &&
        /^[\w-]{43}$/.test(p.code_challenge),
    );
    check("…and no nonce: there's no ID token to carry it", !to.searchParams.has("nonce"));
    check("…and the flow in a cookie of its own: HttpOnly, Lax, 10 minutes", /^haikit_sign_in-0=[^;]+; Max-Age=600; Path=\/; HttpOnly; SameSite=Lax$/.test(flowLine ?? ""));

    const back = await b.get(pathOf(idp.signIn(started.location)));
    const claims = b.claims();
    check("back: a 303 to return_to", back.status === 303 && back.location === "/chats/7?x=1");
    check("…signed in as {name}:{sub}, with the name and the verified email", claims?.sub === "fake:1234" && claims.name === "Ada Lovelace" && claims.email === "ada@example.com");
    check("…and the flow cookie is cleared", !b.flows().length);
    check("…the profile read the API with the access token, as a Bearer token", idp.requests.length === 1 && /^Bearer at-/.test(idp.requests[0].headers.get("authorization")));
    check("…and nothing else of the profile went into the token", !("id" in claims) && !("email_verified" in claims));

    const again = await b.get("/auth/fake");
    await b.get(pathOf(idp.signIn(again.location, { id: 5678, name: "Bob", email: "bob@example.com", email_verified: false })));
    const bob = b.claims();
    check("an unverified email isn't passed on", bob.sub === "fake:5678" && bob.name === "Bob" && !("email" in bob));
  } finally {
    server.close();
  }

  const plain = oauth2({ name: "fake", ...ENDPOINTS, ...CLIENT, redirectUri: REDIRECT, params: { allow_signup: "false" }, profile: me });
  const { url } = await plain.start();
  check("no scopes: no scope sent", !url.searchParams.has("scope"));
  check("params pass through", url.searchParams.get("allow_signup") === "false");
  const queried = await oauth2({ name: "fake", ...ENDPOINTS, authorizationEndpoint: "https://fake.test/authorize?tenant=x", ...CLIENT, redirectUri: REDIRECT, profile: me }).start();
  check("a query the authorizationEndpoint has is kept", queried.url.searchParams.get("tenant") === "x" && queried.url.searchParams.get("response_type") === "code");
}

// ── and every way it can fail ───────────────────────────────────────────
console.log("\nfailures");
{
  const idp = fakeProvider();
  let hook = undefined;
  let read = me;
  const auth = createAuth({
    store: memoryAuthStore(),
    jwt: { secret: SECRET },
    providers: [
      oauth2({
        name: "fake",
        ...ENDPOINTS,
        ...CLIENT,
        redirectUri: REDIRECT,
        failureUrl: "/sign-in?from=fake",
        fetch: idp.fetch,
        profile: (api) => read(api),
        user: (profile) => (hook ? hook(profile) : `fake:${profile.sub}`),
      }),
      oauth2({ name: "other", ...ENDPOINTS, ...CLIENT, redirectUri: "http://localhost/auth/other/callback", fetch: idp.fetch, profile: me }),
    ],
  });
  const { server, browser } = await serve(auth);
  /** Signs in through fake, the callback changed by `change`: how it ended, what was logged, and the token's claims. */
  const trip = async (change = (u) => u, user = ADA) => {
    const c = browser();
    const started = await c.get("/auth/fake");
    let answer;
    const logged = await quietly(async () => (answer = await c.get(pathOf(change(idp.signIn(started.location, user))))));
    return { answer, logged, claims: c.claims(), browser: c };
  };
  const failedWith = (t, text) => why(t.answer) === "failed" && t.logged.some((l) => l.startsWith("[haikit] auth: a sign-in with fake failed:") && l.includes(text)) && t.claims === null;
  try {
    let b = browser();
    let s = await b.get("/auth/fake");
    let r = await b.get(pathOf(idp.deny(s.location)));
    check("the user says no: access_denied, at the failureUrl", why(r) === "access_denied" && r.location === "/sign-in?from=fake&sign_in_error=access_denied");
    check("…and no one is signed in", b.claims() === null && !b.flows().length);

    b = browser();
    s = await b.get("/auth/fake");
    let logged = await quietly(async () => (r = await b.get(pathOf(idp.deny(s.location, "server_error")))));
    check("another error from the provider: failed, logged", why(r) === "failed" && logged.length === 1 && !b.flows().length);

    b = browser();
    s = await b.get("/auth/fake");
    r = await browser().get(pathOf(idp.signIn(s.location)));
    check("no flow cookie: expired", why(r) === "expired" && !r.cookies.length);
    const wrongState = idp.signIn(s.location);
    wrongState.searchParams.set("state", "someone-elses");
    r = await b.get(pathOf(wrongState));
    check("a state that isn't the flow's: expired, and its cookie kept", why(r) === "expired" && b.flows().length === 1);

    b = browser();
    s = await b.get("/auth/other");
    r = await b.get(pathOf(idp.signIn(s.location)).replace("/auth/other/", "/auth/fake/"));
    check("another provider's answer at this one's way back: expired, its cookie kept for it", why(r) === "expired" && b.flows().length === 1 && !r.cookies.length);

    let t = await trip((u) => (u.searchParams.set("iss", "https://evil.test"), u));
    check("an iss on the way back isn't checked: each provider has a way back of its own", t.answer.location === "/" && t.claims?.sub === "fake:1234");

    {
      const c = browser();
      const started = await c.get("/auth/fake");
      const at = new URL(started.location);
      at.searchParams.set("code_challenge", "A".repeat(43)); // a challenge this browser's verifier doesn't answer
      let answer;
      logged = await quietly(async () => (answer = await c.get(pathOf(idp.signIn(at.href)))));
      check("a verifier that doesn't answer the challenge (PKCE): failed, logged", why(answer) === "failed" && logged.length === 1);
    }
    t = await trip((u) => (u.searchParams.set("code", "made-up"), u));
    check("a code the provider never issued: failed, logged", failedWith(t, ""));
    idp.down = true;
    t = await trip();
    idp.down = false;
    check("the token endpoint down: failed, logged", failedWith(t, ""));

    read = async () => {
      throw new Error("the API is down");
    };
    t = await trip();
    check("profile throws: failed, logged", failedWith(t, "the API is down"));
    const malformed = "oauth2: profile must return { sub, claims? }: sub a non-empty string, such as String(user.id), and claims an object";
    for (const [label, answer] of [
      ["a number for sub", { sub: 1234 }],
      ["an empty sub", { sub: "" }],
      ["no sub", { claims: {} }],
      ["claims that aren't an object", { sub: "1", claims: "Ada" }],
      ["claims of null", { sub: "1", claims: null }],
      ["nothing", undefined],
    ]) {
      read = async () => answer;
      check(`profile returns ${label}: failed, logged`, failedWith(await trip(), malformed));
    }
    read = async () => ({ sub: "1234" });
    t = await trip();
    check("profile returns no claims: signed in, with none", t.answer.location === "/" && t.claims?.sub === "fake:1234" && !("name" in t.claims));
    read = me;

    const as = async (fn) => {
      hook = fn;
      const result = await trip();
      hook = undefined;
      return result;
    };
    let got = await as(() => null);
    check("user returns null: refused", why(got.answer) === "refused" && got.claims === null && got.logged.length === 0);
    got = await as(() => {
      throw new Error("the users table is down");
    });
    check("user throws: failed, logged", failedWith(got, "the users table is down"));
    got = await as((profile) => (profile.provider === "fake" && profile.claims.id === 1234 ? `user-${profile.sub}` : null));
    check("user returns a string: that id, with the default claims", got.claims?.sub === "user-1234" && got.claims.name === "Ada Lovelace" && got.claims.email === "ada@example.com");
    got = await as(({ sub }) => ({ userId: `u${sub}`, claims: { role: "admin" } }));
    check("user returns { userId, claims }: exactly those", got.claims?.sub === "u1234" && got.claims.role === "admin" && !("name" in got.claims));
    got = await as(() => ({ userId: "x", claims: { exp: 1 } }));
    check("claims signIn sets itself: failed, logged", failedWith(got, '"exp" is set by signIn'));
  } finally {
    server.close();
  }
}

// ── how the client proves itself ────────────────────────────────────────
console.log("\nclient authentication");
{
  /** Exchanges a code through a provider made with these: the user it signs in, or the error it throws. */
  const exchange = async (idp, over = {}) => {
    const provider = oauth2({ name: "fake", ...ENDPOINTS, ...CLIENT, redirectUri: REDIRECT, profile: me, fetch: idp.fetch, ...over });
    const { url, flow } = await provider.start();
    return provider.finish(idp.signIn(url.href), flow).catch((err) => err);
  };
  check("client_secret_basic by default", (await exchange(fakeProvider()))?.userId === "fake:1234");
  const postOnly = fakeProvider({ accept: "client_secret_post" });
  check("a client registered for client_secret_post: Basic by default, refused", (await exchange(postOnly)) instanceof Error);
  check("…and with tokenEndpointAuthMethod: client_secret_post, signed in", (await exchange(postOnly, { tokenEndpointAuthMethod: "client_secret_post" }))?.userId === "fake:1234");
  const github200 = fakeProvider({ accept: "client_secret_post", errorStatus: 200 });
  const refused = await exchange(github200);
  check("a provider that answers a refused client 200, with the error in the body: thrown", refused instanceof Error && !("userId" in refused));
}

// ── api.get ─────────────────────────────────────────────────────────────
console.log("\napi.get");
{
  const routes = {
    "https://fake.test/api/me": (user, json) => json(200, user),
    "https://fake.test/api/gone": (_user, json) => json(410, { message: "Gone" }),
    "https://fake.test/api/moved": (_user, json) => json(302, {}, { location: "https://elsewhere.test/me" }),
    "https://fake.test/api/text": () => new Response("not json", { status: 200 }),
  };
  const idp = fakeProvider({ routes });
  /** Runs `probe` as the profile, with the api a sign-in gets: what it found, or the error the sign-in threw. */
  const probe = async (fn) => {
    let found;
    const provider = oauth2({
      name: "fake",
      ...ENDPOINTS,
      ...CLIENT,
      redirectUri: REDIRECT,
      fetch: idp.fetch,
      profile: async (api) => {
        found = await fn(api);
        return { sub: "1" };
      },
    });
    const { url, flow } = await provider.start();
    const error = await provider.finish(idp.signIn(url.href), flow).then(
      () => null,
      (err) => err,
    );
    return { found, error };
  };
  idp.requests.length = 0;
  let r = await probe((api) => api.get("https://fake.test/api/me"));
  const [sent] = idp.requests;
  check("the JSON the API answers with", r.found?.name === "Ada Lovelace" && r.error === null);
  check("…asked for as application/json, with the token as Bearer, redirects not followed", sent.headers.get("accept") === "application/json" && /^Bearer /.test(sent.headers.get("authorization")) && sent.redirect === "manual");
  idp.requests.length = 0;
  r = await probe((api) => api.get("https://fake.test/api/me", { Accept: "application/vnd.github+json", "X-Extra": "1", Authorization: "Bearer stolen" }));
  check("…its own headers sent, accept included, but never its own authorization", idp.requests[0].headers.get("accept") === "application/vnd.github+json" && idp.requests[0].headers.get("x-extra") === "1" && idp.requests[0].headers.get("authorization") !== "Bearer stolen" && r.found?.id === 1234);
  for (const url of ["http://fake.test/api/me", "fake.test/api/me", "/api/me"]) {
    r = await probe((api) => api.get(url));
    check(`a URL of ${url}: thrown, and nothing sent`, r.error?.message === "oauth2: api.get takes an https URL: the access token goes with it");
  }
  r = await probe((api) => api.get("https://fake.test/api/gone"));
  check("a 410: thrown, with its status", r.error?.message === "oauth2: GET https://fake.test/api/gone answered 410" && r.error.status === 410);
  r = await probe((api) => api.get("https://fake.test/api/moved"));
  check("a redirect: thrown, with its status, and not followed", r.error?.status === 302);
  r = await probe((api) => api.get("https://fake.test/api/text"));
  check("an answer that isn't JSON: thrown", r.error instanceof SyntaxError);
  r = await probe(async (api) => api.get("https://fake.test/api/gone").catch((err) => err.status));
  check("a profile that catches the error goes on", r.found === 410 && r.error === null);
}

// ── github() ────────────────────────────────────────────────────────────
console.log("\ngithub");
{
  const PROFILE = { login: "ada", id: 583231, name: "Ada Lovelace", email: "ada@public.example", avatar_url: "https://avatars.githubusercontent.com/u/583231" };
  const EMAILS = [
    { email: "ada@old.example", primary: false, verified: true, visibility: null },
    { email: "ada@example.com", primary: true, verified: true, visibility: "private" },
  ];
  const idp = fakeProvider({
    authorize: "https://github.com/login/oauth/authorize",
    token: "https://github.com/login/oauth/access_token",
    accept: "client_secret_post",
    errorStatus: 200,
    routes: {
      "https://api.github.com/user": (user, json) => (user.profile ? json(200, user.profile) : json(500, { message: "Server Error" })),
      "https://api.github.com/user/emails": (user, json) => (typeof user.emails === "number" ? json(user.emails, { message: "Not Found" }) : json(200, user.emails)),
    },
  });
  let asked = 0;
  const auth = createAuth({
    store: memoryAuthStore(),
    jwt: { secret: SECRET },
    providers: [github({ ...CLIENT, redirectUri: "http://localhost:5176/auth/github/callback", fetch: idp.fetch, user: (profile) => (asked++, profile.claims.login === "mallory" ? null : `${profile.provider}:${profile.sub}`) })],
  });
  const plain = github({ ...CLIENT, redirectUri: REDIRECT, fetch: idp.fetch });
  const { server, browser } = await serve(auth);
  /** Signs in to GitHub as this user, with these email addresses (or a status for /user/emails). */
  const as = async (profile, emails = EMAILS, provider = plain) => {
    const { url, flow } = await provider.start();
    return provider.finish(idp.signIn(url.href, { profile, emails }), flow).catch((err) => err);
  };
  try {
    check("named github", plain.name === "github");
    let b = browser();
    let s = await b.get("/auth/github");
    const to = new URL(s.location);
    check("start: GitHub's sign-in page, asking for the profile and the email addresses", to.origin + to.pathname === "https://github.com/login/oauth/authorize" && to.searchParams.get("scope") === "read:user user:email");
    idp.requests.length = 0;
    let r = await b.get(pathOf(idp.signIn(s.location, { profile: PROFILE, emails: EMAILS })));
    const claims = b.claims();
    check("back: signed in as github:{id}", r.location === "/" && claims?.sub === "github:583231" && asked === 1);
    check("…with the name, and the verified primary address, not the public one", claims.name === "Ada Lovelace" && claims.email === "ada@example.com");
    check("…GitHub's API asked as it asks to be", idp.requests.length === 2 && idp.requests.every(({ headers }) => headers.get("accept") === "application/vnd.github+json" && headers.get("x-github-api-version") === "2022-11-28"));

    let got = await as(PROFILE);
    check("the client goes in the body, as GitHub's guide sends it", got?.userId === "github:583231");
    got = await as(PROFILE, EMAILS, github({ ...CLIENT, redirectUri: REDIRECT, tokenEndpointAuthMethod: "client_secret_basic", fetch: idp.fetch }));
    check("…unless tokenEndpointAuthMethod says otherwise: refused with a 200, and thrown", got instanceof Error);
    got = await as({ ...PROFILE, name: null });
    check("no name on GitHub: the login", got?.claims?.name === "ada");
    got = await as({ ...PROFILE, name: "" });
    check("…nor an empty one", got?.claims?.name === "ada");
    got = await as(PROFILE, [{ email: "ada@example.com", primary: true, verified: false }]);
    check("a primary address not yet verified: no email", got?.userId === "github:583231" && !("email" in got.claims));
    for (const status of [404, 403]) {
      got = await as(PROFILE, status);
      check(`/user/emails answers ${status}: signed in without an email`, got?.userId === "github:583231" && got.claims.name === "Ada Lovelace" && !("email" in got.claims));
    }
    got = await as(PROFILE, 500);
    check("…but a 500 there: thrown", got instanceof Error && got.status === 500);
    got = await as(null);
    check("/user failing: thrown", got instanceof Error && got.status === 500);
    got = await as({ login: "ada" });
    check("/user with no id: thrown", got instanceof Error && got.message === "github: GitHub's /user answered with no id");
    got = await as({ ...PROFILE, scopes: undefined }, EMAILS, github({ ...CLIENT, redirectUri: REDIRECT, scopes: [], fetch: idp.fetch }));
    check("scopes: [] sends none", got?.userId === "github:583231");

    let profile;
    await as(PROFILE, EMAILS, github({ ...CLIENT, redirectUri: REDIRECT, fetch: idp.fetch, user: (p) => ((profile = p), "x") }));
    check(
      "user sees all /user says, but its public email, and the verified one with email_verified",
      profile.provider === "github" && profile.sub === "583231" && profile.claims.login === "ada" && profile.claims.avatar_url === PROFILE.avatar_url && profile.claims.email === "ada@example.com" && profile.claims.email_verified === true,
    );

    b = browser();
    s = await b.get("/auth/github");
    r = await b.get(pathOf(idp.signIn(s.location, { profile: { ...PROFILE, login: "mallory", id: 666 }, emails: EMAILS })));
    check("refused by the app's user: refused", why(r) === "refused" && b.claims() === null);
  } finally {
    server.close();
  }
}

console.log(failures ? `\n${failures} check(s) failed\n` : "\noauth2: all checks passed\n");
process.exit(failures ? 1 : 0);
