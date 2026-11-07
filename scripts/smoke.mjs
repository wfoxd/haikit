/**
 * Smoke test — boots each example with its scripted model and drives the loop
 * the framework exists for: a tool renders a surface, the turn parks, an
 * interaction resolves it.
 *
 * Catches the class of break that typechecking cannot: wire protocol drift,
 * a state machine that stops parking, a binding table that stops rejecting.
 *
 * Each example is built with Vite first and served from dist/: the production
 * path, not the dev server. One behind @haikit/auth's gate is signed in first,
 * with a cookie, and checked to refuse anyone who isn't, or isn't its owner.
 */

import { execFileSync, spawn } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

const CASES = [
  {
    name: "hello",
    entry: "examples/hello/src/server/main.ts",
    build: "examples/hello",
    // shadcn/ui's classes, and its dark: variant following the chat's pin
    appCss: ["bg-primary", "data-hai-theme=dark"],
    env: { NODE_ENV: "production" },
    port: 5275,
    message: "greet me",
    tool: "list_greetings",
    component: "greeting_picker",
    action: "choose",
    value: "he",
    expectInResolution: /Chose Hebrew/,
    staleAfterMs: undefined, // greetings never go out of date
    display: {
      message: "show the hebrew one",
      component: "greeting_card",
      action: "copy",
      value: { code: "he" },
      expectInLabel: /Copied the Hebrew greeting/,
    },
  },
  {
    // hello, signed in: the gate lets each user into their own conversations only
    name: "hello-auth",
    entry: "examples/hello-auth/src/server/main.ts",
    build: "examples/hello-auth",
    appCss: ["bg-primary", "data-hai-theme=dark"],
    // without Google, whatever this shell has: the check below needs it off, and no network
    env: { NODE_ENV: "production", HAIKIT_AUTH_SECRET: "a-smoke-test-secret-of-at-least-32-bytes", GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", GITHUB_CLIENT_ID: "", GITHUB_CLIENT_SECRET: "" },
    port: 5276,
    signIn: { as: "ada", stranger: "bob", cookie: "__Host-haikit_token", welcome: "Signed in as ada." },
    message: "greet me",
    tool: "list_greetings",
    component: "greeting_picker",
    action: "choose",
    value: "ja",
    expectInResolution: /Chose Japanese/,
    staleAfterMs: undefined,
    display: {
      message: "show the hebrew one",
      component: "greeting_card",
      action: "copy",
      value: { code: "he" },
      expectInLabel: /Copied the Hebrew greeting/,
    },
  },
  {
    // tutorial 2's app: hello, telling the user things after the request is over
    name: "hello-notices",
    entry: "examples/hello-notices/src/server/main.ts",
    build: "examples/hello-notices",
    appCss: ["bg-primary", "data-hai-theme=dark"],
    env: { NODE_ENV: "production" },
    port: 5274,
    message: "greet me",
    tool: "list_greetings",
    component: "greeting_picker",
    action: "choose",
    value: "es",
    expectInResolution: /Chose Spanish.*Posted it to Sam as a postcard/,
    staleAfterMs: undefined,
    progress: 4, // translator batches list_greetings reports
    // choosing posts a postcard, whose delivery is confirmed later as a notice
    notice: { name: "postcard_delivered", ask: "did my postcard arrive?", expectInReply: /^Yes\. The postcard to Sam was delivered/ },
    // …and the pen pal's reply is a wake notice, so the model speaks unasked
    wake: { name: "reply_received", expectInReply: /^Heads up: Sam replied to the postcard, in Spanish/ },
    // the translators add a language to a picker still waiting, with hai.update
    outside: { component: "greeting_picker", within: 10_000, adds: "cy" },
  },
  {
    name: "flights",
    entry: "examples/flights/src/server/main.ts",
    build: "examples/flights",
    env: { NODE_ENV: "production" },
    port: 5273,
    message: "find me flights to Tokyo next Friday",
    tool: "search_flights",
    component: "flight_table",
    action: "select",
    value: "AC832",
    expectInResolution: /Selected: Air Canada AC832/,
    staleAfterMs: 15 * 60_000,
    progress: 4, // fare sources search_flights reports, one by one
    // picking a flight asks the airline for a hold, confirmed later as a notice
    notice: { name: "hold_confirmed", ask: "is my fare held?", expectInReply: /^Yes\. Air Canada confirmed the fare hold on AC832/ },
    // …and a little later cuts the fare: a wake notice, so the model speaks unasked
    wake: { name: "fare_dropped", expectInReply: /^Heads up: Air Canada dropped the held fare on AC832/ },
    // a seat map revised in place by a tool (ctx.update), for a two-word airline
    revise: { show: "show me the seat map", ask: "window seats only", tool: "highlight_seats", component: "seat_map" },
  },
];

let failures = 0;
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`);
  failures++;
};

/** What every request of the case running sends: a signed-in case's cookie, and the page's origin. */
let signedIn = {};

async function sse(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...signedIn },
    body: JSON.stringify(body),
  });
  const events = [];
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const line = buf.slice(0, i).split("\n").find((l) => l.startsWith("data: "));
      buf = buf.slice(i + 2);
      if (line) events.push(JSON.parse(line.slice(6)));
    }
  }
  return events;
}

// An events stream, read until `done(events)` or `ms` have passed.
async function eventsUntil(url, done, ms, headers = {}) {
  const aborter = new AbortController();
  const timer = setTimeout(() => aborter.abort(), ms);
  const got = [];
  try {
    const res = await fetch(url, { signal: aborter.signal, headers });
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    while (!done(got)) {
      const { value, done: ended } = await reader.read();
      if (ended) break;
      buf += value;
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const lines = buf.slice(0, i).split("\n");
        buf = buf.slice(i + 2);
        const data = lines.find((l) => l.startsWith("data: "));
        if (data) got.push({ id: lines.find((l) => l.startsWith("id: "))?.slice(4), ...JSON.parse(data.slice(6)) });
      }
    }
  } catch {}
  clearTimeout(timer);
  aborter.abort();
  return got;
}

// An events stream, read until `enough` notices or `ms` have passed.
async function notices(url, enough, ms) {
  const aborter = new AbortController();
  const timer = setTimeout(() => aborter.abort(), ms);
  const got = [];
  try {
    const res = await fetch(url, { signal: aborter.signal });
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    while (got.length < enough) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const line = buf.slice(0, i).split("\n").find((l) => l.startsWith("data: "));
        buf = buf.slice(i + 2);
        if (line) got.push(JSON.parse(line.slice(6)));
      }
    }
  } catch {}
  clearTimeout(timer);
  aborter.abort();
  return got;
}

async function waitFor(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

/** Sign in through the example's own form, and return the cookie it sets: `name=value`. */
async function signInAs(base, name) {
  const res = await fetch(`${base}/sign-in`, {
    method: "POST",
    headers: { origin: base, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ name }),
    redirect: "manual",
  });
  return { status: res.status, location: res.headers.get("location"), cookie: res.headers.get("set-cookie") ?? "" };
}

// The page's own module graph: the bundle its index.html loads.
async function clientCode(base) {
  const page = await fetch(`${base}/`, { headers: signedIn }).then((r) => r.text());
  const src = page.match(/<script[^>]+src="([^"]+\.js)"/)?.[1];
  return src ? fetch(new URL(src, base)).then((r) => r.text()) : "";
}

// The page's stylesheet, as Vite built it.
async function pageCss(base) {
  const page = await fetch(`${base}/`, { headers: signedIn }).then((r) => r.text());
  const href = page.match(/<link[^>]+href="([^"]+\.css)"/)?.[1];
  return href ? fetch(new URL(href, base)).then((r) => r.text()) : "";
}

for (const c of CASES) {
  console.log(`\n${c.name}`);
  signedIn = {};
  if (c.build) {
    try {
      execFileSync("npx", ["vite", "build", "--logLevel", "error"], { cwd: path.join(ROOT, c.build), stdio: "pipe" });
      ok("builds with vite");
    } catch (err) {
      bad(`vite build failed\n${err.stderr ?? err.message}`);
      continue;
    }
  }
  const child = spawn("node", [c.entry], {
    cwd: ROOT,
    env: { ...process.env, HAI_SCRIPTED: "1", PORT: String(c.port), ...c.env },
    stdio: "ignore",
  });

  try {
    const base = `http://127.0.0.1:${c.port}`;
    if (!(await waitFor(base + "/"))) {
      bad("server did not start");
      continue;
    }
    ok("boots and serves the page");

    // behind the gate: signed out, nothing; signed in, a cookie, then as any other
    let started;
    if (c.signIn) {
      const page = await fetch(`${base}/`, { redirect: "manual" });
      page.status === 303 && page.headers.get("location") === "/sign-in"
        ? ok("signed out, the page sends you to sign in")
        : bad(`signed out, / answered ${page.status}`);
      const anon = await fetch(`${base}/hai/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: c.message }) });
      const why = await anon.json().catch(() => ({}));
      anon.status === 401 && why.error === "sign in to continue" ? ok("signed out, the routes say 401 sign in to continue") : bad(`signed out, /hai/chat answered ${anon.status}`);
      const signin = await signInAs(base, c.signIn.as);
      const cookie = signin.cookie.split(";")[0];
      signin.status === 303 && cookie.startsWith(`${c.signIn.cookie}=`) && /; Secure/.test(signin.cookie) && /; HttpOnly/.test(signin.cookie)
        ? ok(`signing in sets ${c.signIn.cookie}, HttpOnly and Secure`)
        : bad(`signing in answered ${signin.status} with ${signin.cookie}`);
      signedIn = { cookie, origin: base };
      // the page opens the conversation, so init runs first, as the client does
      started = await sse(`${base}/hai/start`, {});
      started.find((e) => e.type === "block_update")?.result === c.signIn.welcome
        ? ok("init's tool knows who it runs for, from ownerOf(ctx.conversationId)")
        : bad(`init said ${started.find((e) => e.type === "block_update")?.result}`);
      const crossSite = await fetch(`${base}/hai/chat`, { method: "POST", headers: { "content-type": "application/json", cookie, origin: "https://evil.example" }, body: "{}" });
      crossSite.status === 403 ? ok("the cookie from another site is a 403") : bad(`from another site: ${crossSite.status}`);
      // what a URL can't parse is refused, not thrown: a sandboxed frame's origin, and a target such as //[
      const sandboxed = await fetch(`${base}/sign-in`, { method: "POST", headers: { origin: "null", "content-type": "application/x-www-form-urlencoded" }, body: "name=eve", redirect: "manual" });
      const net = await import("node:net");
      const raw = await new Promise((resolve) => {
        let text = "";
        const sock = net.connect(c.port, "127.0.0.1", () => sock.end("GET //[ HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n"));
        sock.on("data", (d) => (text += d));
        sock.on("close", () => resolve(text));
        sock.on("error", () => resolve(text));
      });
      const alive = await fetch(`${base}/sign-in`).then((r) => r.status).catch(() => 0);
      sandboxed.status === 403 && raw.startsWith("HTTP/1.1 400") && alive === 200
        ? ok("a null origin is a 403 and an unparsable target a 400, and the server stays up")
        : bad(`null origin: ${sandboxed.status}, //[: ${raw.split("\r\n")[0]}, then: ${alive}`);
      // without a Google or GitHub client, neither: no link to it, and no route
      const form = await fetch(`${base}/sign-in`).then((r) => r.text());
      for (const [name, provider] of [["google", "Google"], ["github", "GitHub"]]) {
        const route = await fetch(`${base}/auth/${name}`, { redirect: "manual" });
        !form.includes(`/auth/${name}`) && route.status === 404
          ? ok(`without ${name.toUpperCase()}_CLIENT_ID, no ${provider} link and no /auth/${name}`)
          : bad(`without ${provider}: the link ${form.includes(`/auth/${name}`) ? "is there" : "isn't"}, /auth/${name} answered ${route.status}`);
      }
    }

    // one stylesheet: the default UI's, through @haikit/client/tailwind.css,
    // its tokens and its hai: utilities, and the Tailwind classes the app's
    // components use
    const css = await pageCss(base);
    css.includes("--hai-panel") && css.includes(".hai\\:") && (c.appCss ?? ["bg-hai-hover"]).every((rule) => css.includes(rule))
      ? ok("its stylesheet has the default UI's rules and the app's Tailwind classes")
      : bad("the built stylesheet is missing hai.css or the app's classes");

    // 1 · elicit parks the turn
    const startedId = started?.find((e) => e.type === "hello")?.conversationId;
    const turn = await sse(`${base}/hai/chat`, { ...(startedId ? { conversationId: startedId } : {}), message: c.message });
    const conversationId = turn.find((e) => e.type === "hello")?.conversationId;
    const toolBlock = turn.find((e) => e.type === "block_start" && e.block.kind === "tool");
    const uiOpen = turn.find((e) => e.type === "ui_open");
    const status = turn.filter((e) => e.type === "status").at(-1);

    toolBlock?.block.name === c.tool ? ok(`calls ${c.tool}`) : bad(`expected ${c.tool}`);
    const events = turn.find((e) => e.type === "hello")?.events;
    (events === true) === Boolean(c.notice)
      ? ok(c.notice ? "hello opens the events stream" : "hello opens no events stream: the app sends no notices")
      : bad(`hello.events was ${events}`);
    if (c.progress) {
      // UI channel only: on the tool's row, before its surface, never in context
      const frames = turn.filter((e) => e.type === "progress");
      const at = (e) => turn.indexOf(e);
      frames.length && frames.every((f) => f.toolId === toolBlock?.block.id && at(f) > at(toolBlock) && at(f) < at(uiOpen))
        ? ok(`${frames.length} progress frames reach the tool row before its surface`)
        : bad("no progress frames between the tool row and its surface");
      frames.at(-1)?.done === c.progress ? ok("the last progress frame goes out") : bad(`last frame was ${JSON.stringify(frames.at(-1))}`);
      const seen = JSON.stringify(turn.filter((e) => e.type === "context").map((e) => e.messages));
      frames[0]?.message && !seen.includes(frames[0].message)
        ? ok("progress never reaches the model")
        : bad("progress is in the model's context");
    }
    uiOpen?.component === c.component && uiOpen.mode === "elicit"
      ? ok(`renders ${c.component} as elicit`)
      : bad(`expected ${c.component} in elicit mode`);
    turn.some((e) => e.type === "ui_props")
      ? ok("payload reaches the browser")
      : bad("no ui_props");
    // the browser needs the window to close a conversation left open on time
    uiOpen?.staleAfterMs === c.staleAfterMs
      ? ok(c.staleAfterMs ? `its ${c.staleAfterMs / 60_000}-minute window reaches the browser` : "no window is sent for data that never goes stale")
      : bad(`expected staleAfterMs ${c.staleAfterMs}, got ${uiOpen?.staleAfterMs}`);
    status?.status === "awaiting" ? ok("turn parks") : bad(`status is ${status?.status}`);

    // the digest must be short; the payload must not be in it
    const digest = turn.find((e) => e.type === "block_update")?.result ?? "";
    const ctx = turn.find((e) => e.type === "context");
    digest.length > 0 && ctx && ctx.modelTokens < ctx.uiTokens + 1
      ? ok(`digest ${ctx.modelTokens} tok vs payload ${ctx.uiTokens} tok`)
      : bad("dual channel not observable");

    // 2 · the binding table rejects while the surface is still LIVE.
    //     (order matters: after resolving, the frozen check short-circuits first)
    for (const [body, expected] of [
      [{ handle: uiOpen.handle, action: "delete_everything", value: 1 }, "unbound action"],
      [{ handle: "ui_9999", action: c.action, value: c.value }, "unknown handle"],
    ]) {
      const evs = await sse(`${base}/hai/interact`, { conversationId, ...body });
      const msg = evs.find((e) => e.type === "error")?.message;
      msg === expected ? ok(`rejects: ${expected}`) : bad(`expected "${expected}", got "${msg}"`);
    }

    // 3 · interaction resolves it
    const resolved = await sse(`${base}/hai/interact`, {
      conversationId,
      handle: uiOpen.handle,
      action: c.action,
      value: c.value,
    });
    const label = resolved.find((e) => e.type === "block_start" && e.block.kind === "interaction")?.block.label ?? "";
    const frozen = resolved.find((e) => e.type === "ui_state")?.state;
    const endStatus = resolved.filter((e) => e.type === "status").at(-1);

    c.expectInResolution.test(label) ? ok("click becomes the tool_result") : bad(`resolution was: ${label}`);
    frozen === "frozen" ? ok("surface freezes") : bad("surface not frozen");
    endStatus?.status === "idle" ? ok("turn resumes and completes") : bad(`ended ${endStatus?.status}`);

    // 3a · another user, with the conversation's id, is told it doesn't exist
    if (c.signIn) {
      const stranger = (await signInAs(base, c.signIn.stranger)).cookie.split(";")[0];
      const tries = await Promise.all([
        fetch(`${base}/hai/chat`, { method: "POST", headers: { "content-type": "application/json", cookie: stranger, origin: base }, body: JSON.stringify({ conversationId, message: "mine now" }) }),
        fetch(`${base}/hai/interact`, { method: "POST", headers: { "content-type": "application/json", cookie: stranger, origin: base }, body: JSON.stringify({ conversationId, handle: uiOpen.handle, action: c.action, value: c.value }) }),
      ]);
      const said = await Promise.all(tries.map((r) => r.json().catch(() => ({}))));
      tries.every((r) => r.status === 404) && said.every((b) => b.error === "unknown conversation")
        ? ok(`another user is told it's an unknown conversation`)
        : bad(`another user got ${tries.map((r) => r.status)}`);
    }

    // 3b · the click set something going that answers later, as a notice
    if (c.notice) {
      const [notice] = await notices(`${base}/hai/events?conversationId=${conversationId}`, 1, 5_000);
      notice?.type === "notice" && notice.name === c.notice.name && notice.handle === uiOpen.handle
        ? ok(`${c.notice.name} arrives on the events stream, beside the surface it answers`)
        : bad(`expected a ${c.notice.name} notice, got ${JSON.stringify(notice)}`);
      const asked = await sse(`${base}/hai/chat`, { conversationId, message: c.notice.ask });
      const history = asked.filter((e) => e.type === "context").at(-1)?.messages ?? [];
      const carried = history.findLast((m) => m.role === "user")?.content;
      Array.isArray(carried) && carried[0]?.text?.startsWith(`[App notification: ${c.notice.name}]`) && carried.at(-1)?.text === c.notice.ask
        ? ok("the next message carries the notice to the model, ahead of what the user typed")
        : bad(`the next user message was ${JSON.stringify(carried)}`);
      const reply = asked.filter((e) => e.type === "text_delta").map((e) => e.text).join("");
      c.notice.expectInReply.test(reply) ? ok("the model answers from it") : bad(`reply was: ${reply}`);

      // the wake notice starts a turn of its own, streamed where the browser watches
      if (c.wake) {
        const seen = await eventsUntil(
          `${base}/hai/events?conversationId=${conversationId}`,
          (got) => got.some((e) => e.type === "status" && e.status === "idle"),
          8_000,
          { "last-event-id": String(notice.seq) },
        );
        const woke = seen.find((e) => e.type === "notice");
        woke?.name === c.wake.name
          ? ok(`${c.wake.name} arrives as a wake notice`)
          : bad(`expected a ${c.wake.name} notice, got ${JSON.stringify(woke)}`);
        const said = seen.filter((e) => e.type === "text_delta").map((e) => e.text).join("");
        c.wake.expectInReply.test(said) && seen.some((e) => e.type === "status" && e.status === "idle")
          ? ok("it starts a turn on the events stream, and the model speaks unasked")
          : bad(`the wake turn said: ${said || "(nothing)"}`);
      }
    }

    // 3c · a tool revises a surface in place
    if (c.revise) {
      const shown = await sse(`${base}/hai/chat`, { conversationId, message: c.revise.show });
      const map = shown.find((e) => e.type === "ui_open" && e.component === c.revise.component);
      const revised = await sse(`${base}/hai/chat`, { conversationId, message: c.revise.ask });
      const called = revised.find((e) => e.type === "block_start" && e.block.kind === "tool")?.block.name;
      const replacing = revised.find((e) => e.type === "ui_open");
      called === c.revise.tool && replacing?.replaces === map?.handle && replacing.handle !== map?.handle
        ? ok(`${c.revise.tool} revises the ${c.revise.component} in place: ${map?.handle} → ${replacing?.handle}`)
        : bad(`expected ${c.revise.tool} to replace ${map?.handle}, got ${called} / ${JSON.stringify(replacing)}`);
    }

    // 3d · app code revises a surface from outside any turn (hai.update), and
    //      the events stream carries the revision to the browser
    if (c.outside) {
      const fresh = await sse(`${base}/hai/chat`, { message: c.message });
      const freshId = fresh.find((e) => e.type === "hello")?.conversationId;
      const shownNow = fresh.find((e) => e.type === "ui_open" && e.component === c.outside.component);
      const seen = await eventsUntil(
        `${base}/hai/events?conversationId=${freshId}`,
        (got) => got.some((e) => e.type === "ui_props" && e.handle !== shownNow?.handle),
        c.outside.within,
      );
      const opened = seen.find((e) => e.type === "ui_open");
      const props = seen.find((e) => e.type === "ui_props" && e.handle === opened?.handle)?.props;
      opened?.replaces === shownNow?.handle && JSON.stringify(props ?? {}).includes(`"code":"${c.outside.adds}"`)
        ? ok(`app code revises the ${c.outside.component} from outside any turn: ${shownNow?.handle} → ${opened?.handle}`)
        : bad(`expected a revision of ${shownNow?.handle} on the events stream, got ${JSON.stringify(seen.slice(0, 3))}`);
      const told = await sse(`${base}/hai/chat`, { conversationId: freshId, message: "anything new?" });
      const carried = told.filter((e) => e.type === "context").at(-1)?.messages.findLast((m) => m.role === "user")?.content;
      Array.isArray(carried) && carried.some((b) => b?.text?.startsWith(`[UI update] `) && b.text.includes(`was replaced by ${opened?.handle}`))
        ? ok("the next message tells the model which handle replaced which")
        : bad(`the next user message was ${JSON.stringify(carried)}`);
    }

    // 4 · a resolved surface cannot be re-resolved
    const replay = await sse(`${base}/hai/interact`, {
      conversationId, handle: uiOpen.handle, action: c.action, value: c.value,
    });
    replay.find((e) => e.type === "error")?.message === "component is frozen"
      ? ok("rejects: component is frozen")
      : bad("a frozen surface accepted a second resolution");

    // 5 · a DISPLAY surface is the other half of the contract: it renders, the
    //     turn never parks, and an `inform` action lands after the model has
    //     already finished. Untested, this whole path rots — the tutorial's
    //     step 08 shipped without a registered component for exactly that
    //     reason, and the failure is a rendered "unknown component" string
    //     rather than an error anything would notice.
    if (c.display) {
      const d = await sse(`${base}/hai/chat`, { conversationId, message: c.display.message });
      const dOpen = d.find((e) => e.type === "ui_open");
      const dStatus = d.filter((e) => e.type === "status").at(-1);

      dOpen?.component === c.display.component && dOpen.mode === "display"
        ? ok(`renders ${c.display.component} as display`)
        : bad(`expected ${c.display.component} in display mode, got ${dOpen?.component}/${dOpen?.mode}`);
      dStatus?.status === "idle" ? ok("display does not park the turn") : bad(`parked at ${dStatus?.status}`);

      // without this the next block throws instead of reporting, and a crashed
      // harness reads as an infrastructure problem rather than a failed check
      if (!dOpen) {
        bad("no display surface to interact with — skipping the rest");
        child.kill("SIGKILL");
        continue;
      }

      // each component must exist in the browser registry, or the client
      // mounts an error card instead — invisible to every server-side assertion
      const registry = await clientCode(base);
      for (const component of [c.component, c.display.component]) {
        new RegExp(`\\b${component}\\s*:`).test(registry)
          ? ok(`${component} is registered in the built bundle`)
          : bad(`${component} missing from the client registry → "unknown component"`);
      }

      const informed = await sse(`${base}/hai/interact`, {
        conversationId,
        handle: dOpen.handle,
        action: c.display.action,
        value: c.display.value,
      });
      const iLabel = informed.find(
        (e) => e.type === "block_start" && e.block.kind === "interaction",
      )?.block.label ?? "";
      c.display.expectInLabel.test(iLabel)
        ? ok("inform action enriches without having blocked")
        : bad(`inform label was: ${iLabel}`);
    }
  } finally {
    child.kill("SIGKILL");
  }
}

// ── hello-mcp: MCP servers called as each user ──────────────────────────
// Its tools call three MCP servers, each as a different identity: Notes as
// each user's own account there, connected through @haikit/mcp's routes;
// Calendar with each user's own key; Almanac with the app's own. The example
// runs all three, and Notes' authorization server, in its own process, so
// none of this leaves the machine. Asked for their notes before connecting,
// the user gets a card; once they connect, a wake notice has the model call
// the tool again.
{
  console.log("\nhello-mcp");
  signedIn = {};
  const port = 5278;
  const base = `http://127.0.0.1:${port}`;
  const env = {
    NODE_ENV: "production",
    HAI_SCRIPTED: "1",
    PORT: String(port),
    HAIKIT_AUTH_SECRET: "a-smoke-test-secret-of-at-least-32-bytes",
    HAIKIT_MCP_SECRET: "another-smoke-test-secret-of-32-bytes-or-more",
  };
  const said = (events) => events.filter((e) => e.type === "text_delta").map((e) => e.text).join("");
  const resultOf = (events) => events.find((e) => e.type === "block_update")?.result ?? "";
  const doneMessage = async (response) => {
    const found = /data-message="([^"]*)"/.exec(await response.text());
    return found ? JSON.parse(found[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")) : null;
  };
  // nothing a credential is made of, or the link to make one, ever reaches the model
  const secretsIn = (messages) => ["/mcp/connect", "notes_at_", "notes_rt_", "notes_code_", "cal_", "alm_", "Bearer"].filter((s) => JSON.stringify(messages ?? []).includes(s));
  let child;
  try {
    execFileSync("npx", ["vite", "build", "--logLevel", "error"], { cwd: path.join(ROOT, "examples/hello-mcp"), stdio: "pipe" });
    ok("builds with vite");
    child = spawn("node", ["examples/hello-mcp/src/server/main.ts"], { cwd: ROOT, env: { ...process.env, ...env }, stdio: "ignore" });
    if (!(await waitFor(`${base}/sign-in`))) throw new Error("server did not start");
    ok("boots and serves the page");

    signedIn = { cookie: (await signInAs(base, "ada")).cookie.split(";")[0], origin: base };
    const registry = await clientCode(base);
    ["connect_card", "note_list", "note_draft", "account_connected"].every((name) => new RegExp(`\\b${name}\\s*:`).test(registry))
      ? ok("the card, the notes, the draft and the notice are registered in the built bundle")
      : bad("a component is missing from the client registry");

    // 1 · the init tool reads connections(): nothing yet
    const started = await sse(`${base}/hai/start`, {});
    const conversationId = started.find((e) => e.type === "hello")?.conversationId;
    /^Signed in as ada\. Notes isn't connected/.test(resultOf(started))
      ? ok("init reads connections(), and tells the model Notes isn't connected")
      : bad(`init said ${resultOf(started)}`);

    // 2 · asked for their notes, the user gets the connect card; the model gets no link
    const asked = await sse(`${base}/hai/chat`, { conversationId, message: "show my notes" });
    const card = asked.find((e) => e.type === "ui_open");
    const cardProps = asked.find((e) => e.type === "ui_props" && e.handle === card?.handle)?.props;
    asked.find((e) => e.type === "block_start" && e.block.kind === "tool")?.block.name === "show_notes" &&
    card?.component === "connect_card" &&
    card.mode === "display"
      ? ok("show_notes, not connected, renders connect_card as display")
      : bad(`expected a connect_card, got ${JSON.stringify(card)}`);
    cardProps?.need === "connect" && cardProps.href === `/mcp/connect/notes?conversation=${conversationId}`
      ? ok("its href is err.auth.connect, naming the conversation")
      : bad(`its props were ${JSON.stringify(cardProps)}`);
    const history = asked.filter((e) => e.type === "context").at(-1)?.messages;
    resultOf(asked).startsWith("Shown: a button for the user to connect Notes.") && history && !secretsIn(history).length
      ? ok("the model hears the digest, and never the link")
      : bad(`the model heard ${resultOf(asked)}; leaked ${secretsIn(history)}`);
    asked.filter((e) => e.type === "status").at(-1)?.status === "idle" ? ok("the card doesn't park the turn") : bad("the turn parked on the card");

    // 3 · the popup: the connect route, Notes' sign-in, and back to the callback
    const start = await fetch(new URL(cardProps.href, base), { headers: signedIn, redirect: "manual" });
    const to = new URL(start.headers.get("location") ?? base);
    start.status === 303 && to.pathname === "/authorize" && to.origin !== base && to.searchParams.get("code_challenge_method") === "S256" && to.searchParams.get("resource")
      ? ok("the connect route sends the browser to Notes' authorization server, with PKCE and the resource")
      : bad(`the connect route answered ${start.status} to ${to}`);
    const consent = await fetch(to).then((r) => r.text());
    consent.includes("<strong>hello-mcp</strong> wants to") ? ok("Notes asks the user, naming the client registered by DCR") : bad("no consent page");
    const allowed = await fetch(to, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ account: "ada-at-notes", decision: "allow" }),
      redirect: "manual",
    });
    const back = new URL(allowed.headers.get("location") ?? base);
    const done = await fetch(back, { headers: signedIn, redirect: "manual" });
    const message = await doneMessage(done.clone());
    back.pathname === "/mcp/callback" && message?.type === "haikit:mcp" && message.server === "notes" && message.ok === true && /script-src 'sha256-/.test(done.headers.get("content-security-policy") ?? "")
      ? ok("the callback answers the done page, which posts { type: haikit:mcp, server: notes, ok: true }")
      : bad(`the callback answered ${done.status}: ${JSON.stringify(message)}`);
    const replayed = await doneMessage(await fetch(back, { headers: signedIn }));
    replayed?.ok === false && replayed.error === "expired" ? ok("the same callback again is expired: a flow is taken once") : bad(`replayed: ${JSON.stringify(replayed)}`);

    // 4 · onConnected's wake notice starts a turn, which calls the tool again
    const woke = await eventsUntil(
      `${base}/hai/events?conversationId=${conversationId}`,
      (got) => {
        const listed = got.findIndex((e) => e.type === "ui_open" && e.component === "note_list");
        return listed >= 0 && got.slice(listed).some((e) => e.type === "status" && e.status === "idle");
      },
      10_000,
      signedIn,
    );
    const notice = woke.find((e) => e.type === "notice");
    notice?.name === "account_connected" && notice.payload?.server === "notes"
      ? ok("account_connected arrives on the events stream")
      : bad(`expected account_connected, got ${JSON.stringify(notice)}`);
    const wokeContext = woke.filter((e) => e.type === "context").at(-1)?.messages;
    woke.some((e) => e.type === "block_start" && e.block.kind === "tool" && e.block.name === "show_notes") &&
    woke.some((e) => e.type === "ui_open" && e.component === "note_list") &&
    /Here are your 2 notes, from ada-at-notes's Notes account/.test(said(woke))
      ? ok("it wakes the conversation, and the model calls show_notes again, as the account the user connected")
      : bad(`the wake turn said: ${said(woke) || "(nothing)"}`);
    JSON.stringify(wokeContext ?? []).includes("[App notification: account_connected] The user connected Notes.") && !secretsIn(wokeContext).length
      ? ok("the model hears that Notes is connected, and no token")
      : bad(`the wake turn's history leaked ${secretsIn(wokeContext)}`);

    // 5 · a new conversation of the same user: connected once, connected in every one
    const second = await sse(`${base}/hai/start`, {});
    const secondId = second.find((e) => e.type === "hello")?.conversationId;
    /Notes is connected\./.test(resultOf(second)) ? ok("init in a new conversation says Notes is connected") : bad(`init said ${resultOf(second)}`);
    const listed = await fetch(`${base}/mcp/connections`, { headers: signedIn }).then((r) => r.json());
    listed.servers?.length === 1 && listed.servers[0].name === "notes" && listed.servers[0].scope === "notes.read notes.write"
      ? ok("GET /mcp/connections lists Notes, for the settings panel")
      : bad(`connections were ${JSON.stringify(listed)}`);

    // 6 · the approval: draft_note shows the note, and only the click writes it
    const drafted = await sse(`${base}/hai/chat`, { conversationId, message: "note: water the plants" });
    const draft = drafted.find((e) => e.type === "ui_open");
    draft?.component === "note_draft" && draft.mode === "elicit" && drafted.filter((e) => e.type === "status").at(-1)?.status === "awaiting"
      ? ok("draft_note renders note_draft as elicit, and the turn parks")
      : bad(`expected a parked note_draft, got ${JSON.stringify(draft)}`);
    const before = await sse(`${base}/hai/chat`, { conversationId: secondId, message: "show my notes" });
    /^ada-at-notes's 2 notes/.test(resultOf(before)) ? ok("while it waits, Notes still has 2 notes: nothing is written yet") : bad(`before the click: ${resultOf(before)}`);
    const saved = await sse(`${base}/hai/interact`, { conversationId, handle: draft?.handle, action: "decide", value: "save" });
    const label = saved.find((e) => e.type === "block_start" && e.block.kind === "interaction")?.block.label ?? "";
    label === 'Saved to ada-at-notes\'s notes: "water the plants".' && saved.filter((e) => e.type === "status").at(-1)?.status === "idle"
      ? ok("the click's handler makes the MCP call, and its label is the tool_result")
      : bad(`the click's label was: ${label}`);
    const after = await sse(`${base}/hai/chat`, { conversationId: secondId, message: "show my notes" });
    /^ada-at-notes's 3 notes, newest first: "water the plants"/.test(resultOf(after)) ? ok("after it, Notes has the note") : bad(`after the click: ${resultOf(after)}`);

    // 7 · Calendar takes each user's own key, and Almanac the app's
    const adaDay = await sse(`${base}/hai/chat`, { conversationId: secondId, message: "what's on my calendar?" });
    const almanac = await sse(`${base}/hai/chat`, { conversationId: secondId, message: "what day is it?" });
    signedIn = { cookie: (await signInAs(base, "bob")).cookie.split(";")[0], origin: base };
    const bobs = (await sse(`${base}/hai/start`, {})).find((e) => e.type === "hello")?.conversationId;
    const bobDay = await sse(`${base}/hai/chat`, { conversationId: bobs, message: "what's on my calendar?" });
    resultOf(adaDay).startsWith("ada's calendar today: ") && resultOf(bobDay).startsWith("bob's calendar today: ") && resultOf(adaDay).slice(5) !== resultOf(bobDay).slice(5)
      ? ok("bearer(): Calendar sees each user's own key, and answers with their own day")
      : bad(`ada's: ${resultOf(adaDay)}; bob's: ${resultOf(bobDay)}`);
    /^\w+ \d{4}-\d{2}-\d{2}: day \d+ of 36[56]\.$/.test(resultOf(almanac)) ? ok("Almanac answers with the app's own key") : bad(`almanac said ${resultOf(almanac)}`);
    const bobNotes = await sse(`${base}/hai/chat`, { conversationId: bobs, message: "show my notes" });
    bobNotes.find((e) => e.type === "ui_open")?.component === "connect_card"
      ? ok("ada's Notes account is hers: bob is asked to connect his own")
      : bad(`bob got ${JSON.stringify(bobNotes.find((e) => e.type === "ui_open"))}`);

    // 8 · the settings panel disconnects, and the next call shows the card again
    signedIn = { cookie: (await signInAs(base, "ada")).cookie.split(";")[0], origin: base };
    const crossSite = await fetch(`${base}/mcp/disconnect/notes`, { method: "POST", headers: { cookie: signedIn.cookie, origin: "https://evil.example" } });
    const gone = await fetch(`${base}/mcp/disconnect/notes`, { method: "POST", headers: signedIn });
    const left = await fetch(`${base}/mcp/connections`, { headers: signedIn }).then((r) => r.json());
    crossSite.status === 403 && gone.status === 204 && left.servers?.length === 0
      ? ok("POST /mcp/disconnect/notes: 403 from another site, 204 from the app, and it's gone from the list")
      : bad(`disconnect: ${crossSite.status} from another site, ${gone.status} from the app; then ${JSON.stringify(left)}`);
    const again = await sse(`${base}/hai/chat`, { conversationId: secondId, message: "show my notes" });
    again.find((e) => e.type === "ui_open")?.component === "connect_card" ? ok("disconnected, show_notes shows the connect card again") : bad(`after disconnecting: ${resultOf(again)}`);

    // 9 · a draft is for the account it names: connected as another since, its Save writes nothing
    const connectAs = async (account) => {
      const to = (await fetch(`${base}/mcp/connect/notes`, { headers: signedIn, redirect: "manual" })).headers.get("location");
      const allowed = await fetch(to, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ account, decision: "allow" }),
        redirect: "manual",
      });
      return doneMessage(await fetch(allowed.headers.get("location"), { headers: signedIn }));
    };
    const thirdId = (await sse(`${base}/hai/start`, {})).find((e) => e.type === "hello")?.conversationId;
    const backAgain = await connectAs("ada-at-notes");
    const forAda = (await sse(`${base}/hai/chat`, { conversationId: thirdId, message: "note: buy bread" })).find((e) => e.type === "ui_open");
    await fetch(`${base}/mcp/disconnect/notes`, { method: "POST", headers: signedIn });
    const elsewhere = await connectAs("ada-elsewhere");
    const refused = await sse(`${base}/hai/interact`, { conversationId: thirdId, handle: forAda?.handle, action: "decide", value: "save" });
    const refusedLabel = refused.find((e) => e.type === "block_start" && e.block.kind === "interaction")?.block.label ?? "";
    const theirs = await sse(`${base}/hai/chat`, { conversationId: secondId, message: "show my notes" });
    backAgain?.ok && elsewhere?.ok && forAda?.component === "note_draft" &&
    refusedLabel === "Not saved: Notes is connected as another account now, not ada-at-notes. Nothing was written." &&
    /^ada-elsewhere's 2 notes/.test(resultOf(theirs))
      ? ok("a draft shown for one Notes account isn't saved to another the user connected since")
      : bad(`connected: ${backAgain?.ok}, ${elsewhere?.ok}; the click's label: ${refusedLabel}; then ${resultOf(theirs)}`);
  } catch (err) {
    bad(`hello-mcp: ${err.stack ?? err}`);
  } finally {
    child?.kill("SIGKILL");
    signedIn = {};
  }
}

// ── hello-github: GitHub's MCP server, as each user, through a GitHub App ─
// The fourth tutorial's app. It calls GitHub's MCP server with the GitHub
// account each user connects, through a GitHub App: a client the app
// registered, since GitHub registers none on the fly. Offline, it runs
// against the example's stand-in for GitHub, in its own process, configured
// as for the real one. Its tokens last 2 seconds here, not 8 hours, so calls
// a few seconds apart are made with refreshed ones.
{
  console.log("\nhello-github");
  signedIn = {};
  const port = 5280;
  const base = `http://127.0.0.1:${port}`;
  const env = {
    NODE_ENV: "production",
    HAI_SCRIPTED: "1",
    PORT: String(port),
    HAIKIT_AUTH_SECRET: "a-smoke-test-secret-of-at-least-32-bytes",
    HAIKIT_MCP_SECRET: "another-smoke-test-secret-of-32-bytes-or-more",
    GITHUB_STAND_IN_TOKEN_SECONDS: "2",
    // whatever this shell has: sign-in is by name only, and nothing leaves the machine
    GOOGLE_CLIENT_ID: "",
    GOOGLE_CLIENT_SECRET: "",
    GITHUB_CLIENT_ID: "",
    GITHUB_CLIENT_SECRET: "",
  };
  const said = (events) => events.filter((e) => e.type === "text_delta").map((e) => e.text).join("");
  const resultOf = (events) => events.find((e) => e.type === "block_update")?.result ?? "";
  const toolOf = (events) => events.find((e) => e.type === "block_start" && e.block.kind === "tool")?.block.name;
  const doneMessage = async (response) => {
    const found = /data-message="([^"]*)"/.exec(await response.text());
    return found ? JSON.parse(found[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")) : null;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // nothing a credential is made of, the GitHub App's client, or the link to connect, ever reaches the model
  const secretsIn = (messages) => ["/mcp/connect", "ghu_", "ghr_", "Iv23li", "Bearer"].filter((s) => JSON.stringify(messages ?? []).includes(s));
  const contextOf = (events) => events.filter((e) => e.type === "context").at(-1)?.messages;
  const ask = (conversationId, message) => sse(`${base}/hai/chat`, { conversationId, message });
  let child;
  try {
    execFileSync("npx", ["vite", "build", "--logLevel", "error"], { cwd: path.join(ROOT, "examples/hello-github"), stdio: "pipe" });
    ok("builds with vite");
    child = spawn("node", ["examples/hello-github/src/offline.ts"], { cwd: ROOT, env: { ...process.env, ...env }, stdio: "ignore" });
    if (!(await waitFor(`${base}/sign-in`))) throw new Error("server did not start");
    ok("boots against the stand-in for GitHub, and serves the page");

    signedIn = { cookie: (await signInAs(base, "ada")).cookie.split(";")[0], origin: base };
    const registry = await clientCode(base);
    ["greeting_picker", "connect_card", "issue_list", "account_connected"].every((name) => new RegExp(`\\b${name}\\s*:`).test(registry))
      ? ok("the picker, the card, the issues and the notice are registered in the built bundle")
      : bad("a component is missing from the client registry");

    // 1 · welcome reads connections(): nothing yet
    const started = await sse(`${base}/hai/start`, {});
    const conversationId = started.find((e) => e.type === "hello")?.conversationId;
    resultOf(started) === "Signed in as ada. GitHub isn't connected: its tools show the user a button to connect it."
      ? ok("welcome reads connections(), and tells the model GitHub isn't connected")
      : bad(`welcome said ${resultOf(started)}`);

    // 2 · a search before connecting shows the connect card; the model gets no link
    const asked = await ask(conversationId, "find issues about hebrew in haikit-demo/greetings");
    const card = asked.find((e) => e.type === "ui_open");
    const cardProps = asked.find((e) => e.type === "ui_props" && e.handle === card?.handle)?.props;
    toolOf(asked) === "find_issues" && card?.component === "connect_card" && card.mode === "display"
      ? ok("find_issues, not connected, renders connect_card as display")
      : bad(`expected a connect_card, got ${JSON.stringify(card)}`);
    JSON.stringify(cardProps) === JSON.stringify({ server: "github", label: "GitHub", need: "connect", href: `/mcp/connect/github?conversation=${conversationId}` })
      ? ok("its props are connectCardFor(err, \"GitHub\"): the href names the conversation")
      : bad(`its props were ${JSON.stringify(cardProps)}`);
    resultOf(asked) === "Shown: a button for the user to connect GitHub. Its tools work once they have; you'll be told." && !secretsIn(contextOf(asked)).length
      ? ok("the model hears the digest, and never the link")
      : bad(`the model heard ${resultOf(asked)}; leaked ${secretsIn(contextOf(asked))}`);

    // 3 · the popup: the connect route, GitHub's sign-in as the GitHub App, and back to the callback
    const start = await fetch(new URL(cardProps.href, base), { headers: signedIn, redirect: "manual" });
    const to = new URL(start.headers.get("location") ?? base);
    const q = to.searchParams;
    start.status === 303 &&
    to.pathname === "/login/oauth/authorize" &&
    q.get("client_id")?.startsWith("Iv23li") &&
    q.get("redirect_uri") === `http://localhost:${port}/mcp/callback` &&
    q.get("scope") === "offline_access" &&
    q.get("code_challenge_method") === "S256" &&
    q.get("resource")?.endsWith("/mcp/x/issues/readonly")
      ? ok("the connect route sends the browser to GitHub's sign-in, as the GitHub App, asking for offline_access only, with PKCE")
      : bad(`the connect route answered ${start.status} to ${to}`);
    const authorizePage = await fetch(to).then((r) => r.text());
    authorizePage.includes("Authorize hello-github") ? ok("GitHub asks the user to authorize hello-github") : bad("no authorize page");
    const authorized = await fetch(to, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ login: "ada-gh", decision: "authorize" }),
      redirect: "manual",
    });
    const back = new URL(authorized.headers.get("location") ?? base);
    const connectedAt = Date.now();
    const done = await fetch(back, { headers: signedIn, redirect: "manual" });
    const message = await doneMessage(done);
    back.pathname === "/mcp/callback" && back.searchParams.get("iss")?.endsWith("/login/oauth") && message?.type === "haikit:mcp" && message.server === "github" && message.ok === true
      ? ok("the callback trades the code with the client secret, and answers the done page: { type: haikit:mcp, server: github, ok: true }")
      : bad(`the callback answered ${done.status}: ${JSON.stringify(message)}`);

    // 4 · onConnected's wake notice starts a turn, which searches again, as ada's GitHub account
    const woke = await eventsUntil(
      `${base}/hai/events?conversationId=${conversationId}`,
      (got) => {
        const listed = got.findIndex((e) => e.type === "ui_open" && e.component === "issue_list");
        return listed >= 0 && got.slice(listed).some((e) => e.type === "status" && e.status === "idle");
      },
      10_000,
      signedIn,
    );
    const notice = woke.find((e) => e.type === "notice");
    notice?.name === "account_connected" && notice.payload?.server === "github"
      ? ok("account_connected arrives on the events stream")
      : bad(`expected account_connected, got ${JSON.stringify(notice)}`);
    const list = woke.find((e) => e.type === "ui_open" && e.component === "issue_list");
    const listProps = woke.find((e) => e.type === "ui_props" && e.handle === list?.handle)?.props;
    const issue = listProps?.issues?.[0];
    listProps?.total === 1 && issue?.repo === "haikit-demo/greetings" && issue.number === 11 && issue.author === "bob" && /^http:\/\/127\.0\.0\.1:\d+\/haikit-demo\/greetings\/issues\/11$/.test(issue.url)
      ? ok("the wake turn calls find_issues again, and search_issues finds issue 11")
      : bad(`the wake turn listed ${JSON.stringify(listProps)}`);
    Object.keys(issue ?? {}).sort().join() === "author,comments,number,repo,state,title,updatedAt,url" && !JSON.stringify(listProps).includes("Safari")
      ? ok("the browser gets only what the result schema kept: no body, no labels")
      : bad(`issue_list's props were ${JSON.stringify(issue)}`);
    const wokeContext = contextOf(woke);
    JSON.stringify(wokeContext ?? []).includes("[App notification: account_connected] The user connected GitHub.") &&
    /^1 issue matches "hebrew in haikit-demo\/greetings"/.test(said(woke).replace(/^You're connected\. Picking up where we left off\./, "")) &&
    !secretsIn(wokeContext).length
      ? ok("the model hears that GitHub is connected, the digest of what was found, and no token")
      : bad(`the wake turn said ${said(woke)}; leaked ${secretsIn(wokeContext)}`);

    // 5 · an issue, read whole: GitHub's text, cut to size, and marked as someone else's words
    const read = await ask(conversationId, "read issue 7 in haikit-demo/greetings");
    toolOf(read) === "read_issue" && resultOf(read).startsWith("haikit-demo/greetings#7, as GitHub sent it.") && resultOf(read).includes('"title":"Klingon, please"')
      ? ok("read_issue passes the model issue_read's text, through textOf")
      : bad(`read_issue gave ${resultOf(read).slice(0, 200)}`);
    said(read).endsWith('haikit-demo/greetings#7, "Klingon, please", is open: opened by qapla, with 0 comments.') && !/token/i.test(said(read))
      ? ok("an issue's body asks for a token, and the model reports the issue instead")
      : bad(`the model said ${said(read)}`);

    // 6 · GitHub ran the tool and said no: the model hears the app's words, not GitHub's
    const nowhere = await ask(conversationId, "find issues about bugs in haikit-demo/nowhere");
    const missing = await ask(conversationId, "read issue 99 in haikit-demo/greetings");
    const heard = JSON.stringify(contextOf(missing) ?? []);
    resultOf(nowhere) === "GitHub refused the search of haikit-demo/nowhere, as it does for a repository that doesn't exist, or that the user can't see." &&
    resultOf(missing) === "GitHub has no issue haikit-demo/greetings#99 that the user can see." &&
    !heard.includes("Validation Failed") &&
    !heard.includes("api.github.com")
      ? ok("McpToolError: a search and an issue GitHub refused reach the model in the app's words")
      : bad(`the model heard ${resultOf(nowhere)} / ${resultOf(missing)}`);

    // 7 · tokens that expire are refreshed, and GitHub's refresh tokens are spent by each refresh
    const refreshed = [];
    for (const n of [1, 2]) {
      await sleep(Math.max(0, connectedAt + n * 2_500 - Date.now()));
      refreshed.push((await ask(conversationId, "find issues about welsh in haikit-demo/greetings")).some((e) => e.type === "ui_open" && e.component === "issue_list"));
    }
    refreshed.every(Boolean)
      ? ok("past each access token's 2 seconds, a call refreshes it, and the second refresh uses the rotated token")
      : bad(`after the tokens expired, the searches found: ${refreshed.join(", ")}`);

    // 8 · connected once, connected in every conversation of ada's, and in no one else's
    const second = await sse(`${base}/hai/start`, {});
    const listed = await fetch(`${base}/mcp/connections`, { headers: signedIn }).then((r) => r.json());
    /GitHub is connected\./.test(resultOf(second)) && listed.servers?.length === 1 && listed.servers[0].name === "github"
      ? ok("a new conversation's welcome says GitHub is connected, and GET /mcp/connections lists it")
      : bad(`welcome said ${resultOf(second)}; connections were ${JSON.stringify(listed)}`);
    const secondId = second.find((e) => e.type === "hello")?.conversationId;
    signedIn = { cookie: (await signInAs(base, "bob")).cookie.split(";")[0], origin: base };
    const bobs = (await sse(`${base}/hai/start`, {})).find((e) => e.type === "hello")?.conversationId;
    (await ask(bobs, "find issues about hebrew in haikit-demo/greetings")).find((e) => e.type === "ui_open")?.component === "connect_card"
      ? ok("ada's GitHub account is hers: bob is asked to connect his own")
      : bad("bob's search didn't ask him to connect");

    // 9 · disconnecting deletes the app's tokens: GitHub has no revocation endpoint to send them to
    signedIn = { cookie: (await signInAs(base, "ada")).cookie.split(";")[0], origin: base };
    const crossSite = await fetch(`${base}/mcp/disconnect/github`, { method: "POST", headers: { cookie: signedIn.cookie, origin: "https://evil.example" } });
    const gone = await fetch(`${base}/mcp/disconnect/github`, { method: "POST", headers: signedIn });
    const left = await fetch(`${base}/mcp/connections`, { headers: signedIn }).then((r) => r.json());
    const again = await ask(secondId, "find issues about hebrew in haikit-demo/greetings");
    crossSite.status === 403 && gone.status === 204 && left.servers?.length === 0 && again.find((e) => e.type === "ui_open")?.component === "connect_card"
      ? ok("POST /mcp/disconnect/github: 403 from another site, 204 from the app, and the next search shows the card again")
      : bad(`disconnect: ${crossSite.status} from another site, ${gone.status} from the app; then ${JSON.stringify(left)}`);
  } catch (err) {
    bad(`hello-github: ${err.stack ?? err}`);
  } finally {
    child?.kill("SIGKILL");
    signedIn = {};
  }
}

// ── progress is throttled, and only what its type says goes out ─────────
// The flights case shows frames arriving. This one reports faster than the
// throttle allows, and passes what a JavaScript caller might: the frames
// merge, the last always goes out, and anything after the tool returns is
// dropped.
{
  console.log("\nprogress");
  const http = await import("node:http");
  const { defineTool } = await import("../packages/core/dist/index.js");
  const { createHai, memoryStore, nodeHandler } = await import("../packages/server/dist/index.js");

  const count = defineTool({
    name: "count",
    description: "Count to 50.",
    input: { parse: (v) => v },
    inputJsonSchema: { type: "object", properties: {} },
    async run(_input, ctx) {
      ctx.progress({ message: "Counting", done: 0, total: 50 });
      for (let done = 1; done <= 50; done++) ctx.progress({ done });
      ctx.progress({ message: 7, done: -1, total: Infinity }); // nothing here is what its type says
      ctx.progress(null);
      ctx.progress({ total: 0 }); // a workload of nothing has no bar to draw
      setTimeout(() => ctx.progress({ done: 99 }), 0); // after it has returned
      return ctx.text("Counted to 50.");
    },
  });
  const model = {
    id: "counter",
    async generate({ messages }) {
      return typeof messages.at(-1).content === "string"
        ? { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "count", input: {} }] }
        : // open past the throttle window, so a late frame would have been seen
          new Promise((r) => setTimeout(() => r({ stop_reason: "end_turn", content: [{ type: "text", text: "done" }] }), 250));
    },
  };
  const handler = nodeHandler(createHai({ model, store: memoryStore(), tools: [count], surfaces: [], system: "" }), "/hai");
  const server = http.createServer(async (req, res) => {
    if (!(await handler(req, res))) res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(5279, "127.0.0.1", r));

  try {
    const turn = await sse("http://127.0.0.1:5279/hai/chat", { message: "count" });
    const frames = turn.filter((e) => e.type === "progress");
    const finished = turn.findIndex((e) => e.type === "block_update");
    frames.length === 2
      ? ok("54 calls in one tick send 2 frames")
      : bad(`expected 2 frames, got ${frames.length}: ${JSON.stringify(frames)}`);
    JSON.stringify(frames.map(({ type, toolId, ...f }) => f)) ===
    JSON.stringify([{ message: "Counting", done: 0, total: 50 }, { done: 50 }])
      ? ok("the last frame carries the latest count, and fields of the wrong type are dropped")
      : bad(`frames were ${JSON.stringify(frames)}`);
    frames.every((f) => turn.indexOf(f) < finished)
      ? ok("every frame goes out before the row says the call finished")
      : bad("a frame came after the call finished");
    !frames.some((f) => f.done === 99) ? ok("a call after the tool returned sends nothing") : bad("a late call sent a frame");
  } finally {
    server.close();
  }
}

// ── two questions in one reply ──────────────────────────────────────────
// Neither example's scripted model asks two questions at once, but Claude does,
// with parallel tool use. Same wire, a model that asks twice in one reply: one
// question is shown, and every tool_use is answered once it is.
{
  console.log("\ntwo questions in one reply");
  const http = await import("node:http");
  const { defineSurface, defineTool, resolve } = await import("../packages/core/dist/index.js");
  const { createHai, memoryStore, nodeHandler } = await import("../packages/server/dist/index.js");

  const schema = { parse: (v) => v };
  const confirm = defineSurface({ name: "confirm", version: 1, props: schema, actions: { ok: resolve(schema) } })
    .implement({ digest: (p, { handle }) => `Confirm ${p.what} on ${handle}.`, actions: { ok: (_v, { props }) => `Confirmed ${props.what}.` }, queries: {} });
  const ask = defineTool({
    name: "ask",
    description: "Ask the user to confirm something. Blocks.",
    input: schema,
    inputJsonSchema: { type: "object", properties: { what: { type: "string" } }, required: ["what"] },
    run: (input, ctx) => ctx.render(confirm, { what: input.what }, { mode: "elicit" }),
  });
  const model = {
    id: "two-at-once",
    async generate({ messages }) {
      return typeof messages.at(-1).content === "string"
        ? {
            stop_reason: "tool_use",
            content: [
              { type: "tool_use", id: "t1", name: "ask", input: { what: "A" } },
              { type: "tool_use", id: "t2", name: "ask", input: { what: "B" } },
            ],
          }
        : { stop_reason: "end_turn", content: [{ type: "text", text: "done" }] };
    },
  };
  const handler = nodeHandler(createHai({ model, store: memoryStore(), tools: [ask], surfaces: [confirm], system: "" }), "/hai");
  const server = http.createServer(async (req, res) => {
    if (!(await handler(req, res))) res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(5277, "127.0.0.1", r));

  try {
    const base = "http://127.0.0.1:5277";
    const turn = await sse(`${base}/hai/chat`, { message: "confirm A and B" });
    const conversationId = turn.find((e) => e.type === "hello")?.conversationId;
    const opens = turn.filter((e) => e.type === "ui_open");
    opens.length === 1 ? ok("one question is shown") : bad(`${opens.length} questions shown`);
    turn.some((e) => e.type === "block_update" && /^Not shown: ui_\d+ is already waiting/.test(e.result ?? ""))
      ? ok("the second call is told it wasn't shown")
      : bad("no refusal for the second call");
    turn.filter((e) => e.type === "status").at(-1)?.status === "awaiting" ? ok("turn parks") : bad("turn did not park");

    const answered = await sse(`${base}/hai/interact`, { conversationId, handle: opens[0]?.handle, action: "ok", value: {} });
    const history = answered.filter((e) => e.type === "context").at(-1)?.messages ?? [];
    const blocks = history.flatMap((m) => (Array.isArray(m.content) ? m.content : []));
    const results = new Set(blocks.filter((b) => b.type === "tool_result").map((b) => b.tool_use_id));
    const open = blocks.filter((b) => b.type === "tool_use" && !results.has(b.id)).map((b) => b.id);
    history.length && open.length === 0
      ? ok("every tool_use has a tool_result once it is answered")
      : bad(`tool_use without tool_result: ${open.join(", ") || "no history"}`);
    answered.filter((e) => e.type === "status").at(-1)?.status === "idle" ? ok("turn resumes and completes") : bad("turn did not complete");
  } finally {
    server.close();
  }
}

console.log(failures ? `\n${failures} check(s) failed\n` : "\nsmoke: all checks passed\n");
process.exit(failures ? 1 : 0);
