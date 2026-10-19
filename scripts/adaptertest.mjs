#!/usr/bin/env node
/**
 * Model adapter tests, with no network and no key.
 *
 * `@haikit/openai` translates HaiKIT's history (the Anthropic Messages shape)
 * into Responses API input and back. A mistake there costs nothing to make and
 * a whole turn to find: the API refuses the request, or the model loses track
 * of a call. So every shape the runtime writes into the history is mapped
 * here, and a fake client replays a stream through a real turn.
 *
 *   node scripts/adaptertest.mjs
 */

import { fromOutput, isStrictCompatible, toInput, toTools } from "../packages/openai/dist/mapping.js";
import { createAdapter } from "../packages/openai/dist/adapter.js";
import { openai } from "../packages/openai/dist/index.js";

let failures = 0;
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m, detail) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`);
  if (detail !== undefined) console.log(`      ${JSON.stringify(detail)}`);
  failures++;
};
const check = (name, cond, detail) => (cond ? ok(name) : bad(name, detail));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const throws = (fn, pattern) => {
  try {
    fn();
    return false;
  } catch (err) {
    return pattern.test(err.message);
  }
};

// ── the history, out ────────────────────────────────────────────────────
console.log("\nhistory → input");
{
  const init = [
    { role: "user", content: "[conversation started]" },
    { role: "assistant", content: [{ type: "tool_use", id: "toolu_init_0123456789abcdef", name: "setup", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_init_0123456789abcdef", content: "ready" }] },
  ];
  check(
    "the init call and its result become a function call and its output",
    same(toInput(init), [
      { role: "user", content: "[conversation started]" },
      { type: "function_call", call_id: "toolu_init_0123456789abcdef", name: "setup", arguments: "{}" },
      { type: "function_call_output", call_id: "toolu_init_0123456789abcdef", output: "ready" },
    ]),
    toInput(init),
  );

  const notices = [
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "call_a", content: "first" },
        { type: "tool_result", tool_use_id: "call_b", content: [{ type: "text", text: "two" }, { type: "text", text: "lines" }] },
        { type: "text", text: "[App notification: price] dropped" },
      ],
    },
  ];
  check(
    "tool results go first, then the notices' text as one user message",
    same(toInput(notices), [
      { type: "function_call_output", call_id: "call_a", output: "first" },
      { type: "function_call_output", call_id: "call_b", output: "two\nlines" },
      { role: "user", content: [{ type: "input_text", text: "[App notification: price] dropped" }] },
    ]),
    toInput(notices),
  );

  const text = [{ role: "user", content: [{ type: "text", text: "hi" }, { type: "text", text: "there" }] }];
  check(
    "a user message of text blocks keeps them as input_text",
    same(toInput(text), [{ role: "user", content: [{ type: "input_text", text: "hi" }, { type: "input_text", text: "there" }] }]),
  );

  const reply = [
    {
      role: "assistant",
      content: [
        { type: "openai_reasoning", id: "rs_1", summary: [], encrypted_content: "sealed" },
        { type: "text", text: "" },
        { type: "text", text: "Looking." },
        { type: "tool_use", id: "call_c", name: "search", input: { q: "x" } },
      ],
    },
  ];
  check(
    "an assistant reply sends its reasoning back, skips empty text, and keeps the call's arguments",
    same(toInput(reply), [
      { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "sealed" },
      { role: "assistant", content: "Looking." },
      { type: "function_call", call_id: "call_c", name: "search", arguments: '{"q":"x"}' },
    ]),
    toInput(reply),
  );

  check(
    "a block it can't send fails with its type named",
    throws(() => toInput([{ role: "assistant", content: [{ type: "thinking", thinking: "…" }] }]), /cannot send a "thinking" block in an assistant message/),
  );
  check(
    "an image in a tool result fails too",
    throws(
      () => toInput([{ role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: [{ type: "image" }] }] }]),
      /cannot send a "image" block in a tool_result/,
    ),
  );

  const history = [{ role: "user", content: [{ type: "text", text: "hi" }] }];
  const before = JSON.stringify(history);
  toInput(history);
  check("the history is left unchanged", JSON.stringify(history) === before);
}

// ── the reply, in ───────────────────────────────────────────────────────
console.log("\noutput → content");
{
  const calls = fromOutput({
    status: "completed",
    output: [
      { type: "reasoning", id: "rs_1", summary: [{ type: "summary_text", text: "plan" }], encrypted_content: "sealed" },
      { type: "message", content: [{ type: "output_text", text: "Searching." }] },
      { type: "function_call", call_id: "call_1", name: "search", arguments: '{"q":"tokyo"}' },
    ],
  });
  check(
    "a reply with a function call stops for tools",
    calls.stop_reason === "tool_use" &&
      same(calls.content, [
        { type: "openai_reasoning", id: "rs_1", summary: [{ type: "summary_text", text: "plan" }], encrypted_content: "sealed" },
        { type: "text", text: "Searching." },
        { type: "tool_use", id: "call_1", name: "search", input: { q: "tokyo" } },
      ]),
    calls,
  );

  const done = fromOutput({ status: "completed", output: [{ type: "reasoning", id: "rs_2", summary: [] }, { type: "message", content: [{ type: "output_text", text: "Hi." }] }] });
  check("a reply with no call ends the turn", done.stop_reason === "end_turn");
  check("a reasoning item with no encrypted content is dropped", same(done.content, [{ type: "text", text: "Hi." }]), done.content);

  const cut = fromOutput({
    status: "incomplete",
    incomplete_details: { reason: "max_output_tokens" },
    output: [{ type: "function_call", call_id: "call_2", name: "search", arguments: '{"q":"to' }],
  });
  check(
    "a reply cut off mid-call is max_tokens, and the call's input is {}",
    cut.stop_reason === "max_tokens" && same(cut.content, [{ type: "tool_use", id: "call_2", name: "search", input: {} }]),
    cut,
  );

  const filtered = fromOutput({ status: "incomplete", incomplete_details: { reason: "content_filter" }, output: [] });
  check("a content filter is a refusal", filtered.stop_reason === "refusal");

  const refused = fromOutput({ status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "No." }] }] });
  check("a refusal's text is kept as text", same(refused.content, [{ type: "text", text: "No." }]) && refused.stop_reason === "end_turn");

  check(
    "a failed response throws with OpenAI's message",
    throws(() => fromOutput({ status: "failed", error: { code: "server_error", message: "boom" }, output: [] }), /the response failed: boom/),
  );
  check("a cancelled one throws too", throws(() => fromOutput({ status: "cancelled", output: [] }), /the response cancelled$/));

  check(
    "in a complete reply, arguments that aren't a JSON object fail the call",
    throws(() => fromOutput({ status: "completed", output: [{ type: "function_call", call_id: "c", name: "search", arguments: "[1]" }] }), /called search with arguments that aren't a JSON object/) &&
      throws(() => fromOutput({ status: "completed", output: [{ type: "function_call", call_id: "c", name: "search", arguments: '{"q":' }] }), /aren't a JSON object/),
  );
  const cutOther = fromOutput({ status: "incomplete", incomplete_details: { reason: "content_filter" }, output: [{ type: "function_call", call_id: "c", name: "n", arguments: "[1]" }] });
  check("in an incomplete one, for any reason, they become {}", same(cutOther.content[0].input, {}) && cutOther.stop_reason !== "tool_use", cutOther);
}

// ── tools ───────────────────────────────────────────────────────────────
console.log("\ntools");
{
  const closed = { type: "object", properties: { a: { type: "string" } }, required: ["a"], additionalProperties: false };
  check("a closed schema with everything required is strict-compatible", isStrictCompatible(closed));
  check("an optional property isn't", !isStrictCompatible({ ...closed, required: [] }));
  check("an open object isn't", !isStrictCompatible({ type: "object", properties: { a: { type: "string" } }, required: ["a"] }));
  check(
    "nor is one nested in an array",
    !isStrictCompatible({
      type: "object",
      properties: { rows: { type: "array", items: { type: "object", properties: { x: { type: "number" } } } } },
      required: ["rows"],
      additionalProperties: false,
    }),
  );
  check("an empty closed object is", isStrictCompatible({ type: "object", properties: {}, additionalProperties: false }));

  const tools = toTools([
    { name: "a", description: "da", input_schema: closed, strict: true },
    { name: "b", description: "db", input_schema: { ...closed, required: [] }, strict: true },
    { name: "query_ui", description: "dq", input_schema: closed, strict: false },
  ]);
  check(
    "each tool is a function tool, strict only when it asks and the schema allows",
    same(tools, [
      { type: "function", name: "a", description: "da", parameters: closed, strict: true },
      { type: "function", name: "b", description: "db", parameters: { ...closed, required: [] }, strict: false },
      { type: "function", name: "query_ui", description: "dq", parameters: closed, strict: false },
    ]),
    tools,
  );
}

// ── the request, through a fake client ──────────────────────────────────
// Streams these events and ends with `final`, recording what it was sent.
function fakeClient(replies) {
  const sent = [];
  let made = 0;
  return {
    sent,
    get made() {
      return made;
    },
    async make() {
      made++;
      return {
        responses: {
          stream(params) {
            sent.push(structuredClone(params));
            const { events, final } = replies.shift();
            return {
              async *[Symbol.asyncIterator]() {
                yield* events;
              },
              finalResponse: async () => final,
            };
          },
        },
      };
    },
  };
}

console.log("\nrequest");
{
  const fake = fakeClient([
    {
      events: [
        { type: "response.output_text.delta", delta: "Hel" },
        { type: "response.function_call_arguments.delta", delta: "{" },
        { type: "response.output_text.delta", delta: "lo" },
        { type: "response.refusal.delta", delta: "!" },
      ],
      final: { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "Hello" }] }] },
    },
    { events: [], final: { status: "completed", output: [] } },
  ]);
  const adapter = createAdapter({}, () => fake.make());
  check("the default model is gpt-6-luna, and the id", adapter.id === "gpt-6-luna");

  const deltas = [];
  const request = {
    system: "be brief",
    tools: [{ name: "a", description: "d", input_schema: { type: "object" }, strict: true }],
    messages: [{ role: "user", content: "hi" }],
    onTextDelta: (t) => deltas.push(t),
  };
  const result = await adapter.generate(request);
  check("text and refusal deltas stream, nothing else", same(deltas, ["Hel", "lo", "!"]), deltas);
  check("it returns the mapped final response", same(result, { content: [{ type: "text", text: "Hello" }], stop_reason: "end_turn" }), result);
  check(
    "the request: instructions, tools, input, defaults, no storage",
    same(fake.sent[0], {
      model: "gpt-6-luna",
      instructions: "be brief",
      tools: [{ type: "function", name: "a", description: "d", parameters: { type: "object" }, strict: false }],
      input: [{ role: "user", content: "hi" }],
      max_output_tokens: 16000,
      store: false,
      reasoning: { effort: "medium" },
      include: ["reasoning.encrypted_content"],
    }),
    fake.sent[0],
  );

  await adapter.generate(request);
  check("the client is made once", fake.made === 1);

  const tuned = fakeClient([{ events: [], final: { status: "completed", output: [] } }]);
  const custom = createAdapter({ model: "gpt-x", maxTokens: 500, effort: "low", promptCacheKey: "app" }, () => tuned.make());
  await custom.generate(request);
  const p = tuned.sent[0];
  check(
    "options become model, max_output_tokens, reasoning.effort and prompt_cache_key",
    custom.id === "gpt-x" && p.model === "gpt-x" && p.max_output_tokens === 500 && p.reasoning.effort === "low" && p.prompt_cache_key === "app",
    p,
  );

  const plain = fakeClient([{ events: [], final: { status: "completed", output: [] } }]);
  await createAdapter({ model: "gpt-4.1", effort: null }, () => plain.make()).generate(request);
  check(
    "effort: null sends neither reasoning nor its include, for a model that doesn't reason",
    !("reasoning" in plain.sent[0]) && !("include" in plain.sent[0]) && plain.sent[0].store === false,
    plain.sent[0],
  );

  check("openai() builds an adapter without loading the SDK or a key", openai().id === "gpt-6-luna");
}

// ── a real turn ─────────────────────────────────────────────────────────
// The runtime records the reply, runs the call, and sends the result back:
// the second request has to pair the output with the call by its id.
console.log("\na turn through the runtime");
{
  const { createHai, memoryStore } = await import("../packages/server/dist/index.js");
  const { defineTool } = await import("../packages/core/dist/index.js");

  const greet = defineTool({
    name: "greet",
    description: "say hello",
    input: { parse: (v) => v },
    inputJsonSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"], additionalProperties: false },
    async run(input, ctx) {
      return ctx.text(`greeted ${input.name}`);
    },
  });

  const fake = fakeClient([
    {
      events: [],
      final: {
        status: "completed",
        output: [
          { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "sealed" },
          { type: "function_call", call_id: "call_9", name: "greet", arguments: '{"name":"Ada"}' },
        ],
      },
    },
    {
      events: [{ type: "response.output_text.delta", delta: "Done." }],
      final: { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "Done." }] }] },
    },
  ]);

  const store = memoryStore();
  const hai = createHai({ model: createAdapter({}, () => fake.make()), store, tools: [greet], surfaces: [], system: "x" });
  const conversation = await store.loadConversation(undefined);
  const events = [];
  await hai.send(conversation, "greet Ada", (e) => events.push(e));

  check("two model calls", fake.sent.length === 2, fake.sent.length);
  check("the tool is offered strict", fake.sent[0].tools.find((t) => t.name === "greet")?.strict === true);
  check(
    "the second call sends the reasoning, the call and its output back, in order",
    same(fake.sent[1].input.slice(-3), [
      { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "sealed" },
      { type: "function_call", call_id: "call_9", name: "greet", arguments: '{"name":"Ada"}' },
      { type: "function_call_output", call_id: "call_9", output: "greeted Ada" },
    ]),
    fake.sent[1].input,
  );
  check("the reply's text streams to the browser", events.some((e) => e.type === "text_delta" && e.text === "Done."));
}

// ── through the real SDK ────────────────────────────────────────────────
// The fake client above stands in for the SDK, so this checks the stand-in is
// honest: the real one, pointed at a local server streaming Responses API
// events, has to produce the same deltas and the same final response.
console.log("\nthrough the OpenAI SDK");
{
  const http = await import("node:http");
  const message = { type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Hi there", annotations: [] }] };
  const call = { type: "function_call", id: "fc_1", call_id: "call_1", name: "greet", arguments: '{"name":"Ada"}', status: "completed" };
  const response = (status, output) => ({ id: "resp_1", object: "response", created_at: 0, model: "gpt-6-luna", status, output, error: null, incomplete_details: null });
  const events = [
    { type: "response.created", response: response("in_progress", []) },
    { type: "response.output_item.added", output_index: 0, item: { ...message, status: "in_progress", content: [] } },
    { type: "response.content_part.added", output_index: 0, content_index: 0, item_id: "msg_1", part: { type: "output_text", text: "", annotations: [] } },
    { type: "response.output_text.delta", output_index: 0, content_index: 0, item_id: "msg_1", delta: "Hi ", logprobs: [] },
    { type: "response.output_text.delta", output_index: 0, content_index: 0, item_id: "msg_1", delta: "there", logprobs: [] },
    { type: "response.output_text.done", output_index: 0, content_index: 0, item_id: "msg_1", text: "Hi there", logprobs: [] },
    { type: "response.content_part.done", output_index: 0, content_index: 0, item_id: "msg_1", part: message.content[0] },
    { type: "response.output_item.done", output_index: 0, item: message },
    { type: "response.output_item.added", output_index: 1, item: { ...call, arguments: "", status: "in_progress" } },
    { type: "response.function_call_arguments.delta", output_index: 1, item_id: "fc_1", delta: '{"name":"Ada"}' },
    { type: "response.function_call_arguments.done", output_index: 1, item_id: "fc_1", arguments: '{"name":"Ada"}' },
    { type: "response.output_item.done", output_index: 1, item: call },
    { type: "response.completed", response: response("completed", [message, call]) },
  ].map((e, i) => ({ ...e, sequence_number: i }));
  const failed = [
    { type: "response.created", response: response("in_progress", []) },
    { type: "response.failed", response: { ...response("failed", []), error: { code: "server_error", message: "boom" } } },
  ].map((e, i) => ({ ...e, sequence_number: i }));
  const streams = [events, failed];

  let received = null;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received = { path: req.url, auth: req.headers.authorization, body: JSON.parse(body) };
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const e of streams.shift()) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
      res.end();
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));

  try {
    const adapter = openai({ apiKey: "sk-local-test", baseURL: `http://127.0.0.1:${server.address().port}/v1` });
    const deltas = [];
    const result = await adapter.generate({
      system: "x",
      tools: [],
      messages: [{ role: "user", content: "hi" }],
      onTextDelta: (t) => deltas.push(t),
    });
    check("it posts to /responses with the key, streaming", received?.path === "/v1/responses" && received.auth === "Bearer sk-local-test" && received.body.stream === true, received);
    check("the request body carries store: false", received?.body.store === false);
    check("the deltas arrive through the SDK", same(deltas, ["Hi ", "there"]), deltas);
    check(
      "and the final response maps as the fake's did",
      same(result, {
        content: [
          { type: "text", text: "Hi there" },
          { type: "tool_use", id: "call_1", name: "greet", input: { name: "Ada" } },
        ],
        stop_reason: "tool_use",
      }),
      result,
    );

    let error = null;
    await adapter.generate({ system: "x", tools: [], messages: [{ role: "user", content: "hi" }], onTextDelta() {} }).catch((e) => (error = e));
    check("a streamed response.failed rejects with OpenAI's message", /the response failed: boom/.test(error?.message ?? ""), error?.message);
  } finally {
    server.close();
  }
}

console.log(failures ? `\n\x1b[31m${failures} failed\x1b[0m` : "\n\x1b[32mall passed\x1b[0m");
process.exit(failures ? 1 : 0);
