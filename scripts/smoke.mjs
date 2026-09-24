/**
 * Smoke test — boots each example with its scripted model and drives the loop
 * the framework exists for: a tool renders a surface, the turn parks, an
 * interaction resolves it.
 *
 * Catches the class of break that typechecking cannot: wire protocol drift,
 * a state machine that stops parking, a binding table that stops rejecting.
 */

import { spawn } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

const CASES = [
  {
    name: "hello",
    entry: "examples/hello/src/server/main.ts",
    port: 5275,
    message: "greet me",
    tool: "list_greetings",
    component: "greeting_picker",
    action: "choose",
    value: "he",
    expectInResolution: /Chose Hebrew/,
    display: {
      message: "show the hebrew one",
      component: "greeting_card",
      action: "copy",
      value: { code: "he" },
      expectInLabel: /Copied the Hebrew greeting/,
    },
  },
  {
    name: "flights",
    entry: "examples/flights/src/server/main.ts",
    port: 5273,
    message: "find me flights to Tokyo next Friday",
    tool: "search_flights",
    component: "flight_table",
    action: "select",
    value: "AC832",
    expectInResolution: /Selected: Air Canada AC832/,
  },
];

let failures = 0;
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`);
  failures++;
};

async function sse(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
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

for (const c of CASES) {
  console.log(`\n${c.name}`);
  const child = spawn("node", [c.entry], {
    cwd: ROOT,
    env: { ...process.env, HAI_SCRIPTED: "1", PORT: String(c.port) },
    stdio: "ignore",
  });

  try {
    const base = `http://127.0.0.1:${c.port}`;
    if (!(await waitFor(base + "/"))) {
      bad("server did not start");
      continue;
    }
    ok("boots and serves the page");

    // 1 · elicit parks the turn
    const turn = await sse(`${base}/hai/chat`, { message: c.message });
    const conversationId = turn.find((e) => e.type === "hello")?.conversationId;
    const toolBlock = turn.find((e) => e.type === "block_start" && e.block.kind === "tool");
    const uiOpen = turn.find((e) => e.type === "ui_open");
    const status = turn.filter((e) => e.type === "status").at(-1);

    toolBlock?.block.name === c.tool ? ok(`calls ${c.tool}`) : bad(`expected ${c.tool}`);
    uiOpen?.component === c.component && uiOpen.mode === "elicit"
      ? ok(`renders ${c.component} as elicit`)
      : bad(`expected ${c.component} in elicit mode`);
    turn.some((e) => e.type === "ui_props")
      ? ok("payload reaches the browser")
      : bad("no ui_props");
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

      // the component must exist in the browser registry, or the client mounts
      // an error card instead — invisible to every server-side assertion
      const registry = await fetch(`${base}/components.js`).then((r) => r.text());
      new RegExp(`\\b${c.display.component}\\s*:`).test(registry)
        ? ok(`${c.display.component} is registered in components.js`)
        : bad(`${c.display.component} missing from the client registry → "unknown component"`);

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

console.log(failures ? `\n${failures} check(s) failed\n` : "\nsmoke: all checks passed\n");
process.exit(failures ? 1 : 0);
