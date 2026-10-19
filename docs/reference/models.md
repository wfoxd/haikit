# Models

The runtime talks to a model through one interface, `ModelAdapter`: an id and
a `generate` method shaped like the Anthropic Messages API. `@haikit/anthropic`
implements it for Claude, and `@haikit/openai` for OpenAI models. Any object
that satisfies it plugs in, such as the scripted models the examples use to
run with no API key.

Exported by `@haikit/core`: `ModelAdapter`, `ModelRequest`, `ModelResponse`.
By `@haikit/anthropic`: `anthropic`, `AnthropicOptions`. By `@haikit/openai`:
`openai`, `OpenAIOptions`.

Checked against `@haikit/*` 0.20.0. Source: `packages/core/src/index.ts`,
`packages/server/src/runtime.ts`, `packages/anthropic/src/index.ts` and
`packages/openai/src/*.ts`.

- [The interface](#the-interface): `ModelAdapter`, `ModelRequest`,
  `ModelResponse`
- [How the runtime uses it](#how-the-runtime-uses-it)
- [Claude: `@haikit/anthropic`](#claude-haikitanthropic): `anthropic`,
  `AnthropicOptions`
- [OpenAI: `@haikit/openai`](#openai-haikitopenai): `openai`,
  `OpenAIOptions`
- [Writing an adapter](#writing-an-adapter)

## The interface

### `ModelAdapter`

```ts
interface ModelAdapter {
  readonly id: string;
  generate(request: ModelRequest): Promise<ModelResponse>;
}
```

| Member | Meaning |
| --- | --- |
| `id` | A name for the model. Sent to the browser in `hello` as `model`, which the default UI shows. The runtime doesn't use it otherwise |
| `generate` | Makes one model call: given the system prompt, the tools and the history, returns the model's reply |

### `ModelRequest`

```ts
interface ModelRequest {
  system: string;
  tools: { name: string; description: string; input_schema: JsonSchema; strict?: boolean }[];
  messages: Message[];
  onTextDelta: (text: string) => void;
}
```

| Field | Meaning |
| --- | --- |
| `system` | `hai.system`: the app's `system` and the scope (see [The server](server.md#scope)). The same on every call |
| `tools` | Every tool the model may call, in the order it's offered them: the app's tools, `query_ui`, then the init tool (see [Tools: registration](tools.md#definetool)). Each has its `name`, its `description` (with the init note appended for the init tool), its `inputJsonSchema` as `input_schema`, and `strict`. The list is the same on every call of every conversation |
| `messages` | The conversation's whole history, in the Messages API's shape (see [Conversations](conversations.md#message)). It's the runtime's own array, not a copy: an adapter must not change it |
| `onTextDelta` | Call it with each piece of the reply's text as it arrives. That's how text streams to the browser |

### `ModelResponse`

```ts
interface ModelResponse {
  content: any[];
  stop_reason: string;
}
```

| Field | Meaning |
| --- | --- |
| `content` | The reply's content blocks, in the Messages API's shape. Recorded in the history exactly as returned |
| `stop_reason` | Why the reply ended. `"tool_use"` means it asks for tools. Anything else ends the turn |

## How the runtime uses it

Each hop of a turn makes one `generate` call (see
[The server](server.md#how-a-turn-runs)):

1. **It calls `generate`** with `hai.system`, the tool list, the history, and
   an `onTextDelta`.
2. **Text streams to the browser only through `onTextDelta`.** The first call
   opens an `assistant` block, and each call sends a `text_delta`. Text that's
   in `content` but was never passed to `onTextDelta` is recorded in the
   history, but the transcript doesn't show it. It reaches the browser only
   inside the `context` event's history, which the debug drawer shows.
3. **The reply's `content` is recorded** as an assistant message.
4. **If `stop_reason` is `"tool_use"`,** every block in `content` with
   `type: "tool_use"` is run, in order, using its `id`, `name` and `input`
   (see [Tools](tools.md#how-a-tool-call-runs)). Their results go into one
   user message, each a `tool_result` block with the call's `id` as
   `tool_use_id`, and the next hop begins. Unless a call showed a question:
   then the turn parks, and the next `generate` call comes in a later
   request. And unless this was the `maxHops`th call: then the turn ends (see
   [The server](server.md#maxhops)).
5. **Any other `stop_reason` ends the turn,** including `"max_tokens"`,
   unless the reply holds `tool_use` blocks. Those aren't run, since their
   input may be cut short: each gets a `tool_result` saying it wasn't, and
   the next hop begins, so the model can answer or try again (see
   [The server](server.md#how-a-turn-runs)). A reply with
   `stop_reason: "tool_use"` but no `tool_use` block ends the turn. The
   runtime doesn't continue a reply's text that was cut off.

**If `generate` throws** (or rejects), the turn ends there and the caller
reports the error. What the turn recorded before stays saved, except in a
wake turn where no tool call has happened yet, which is undone (see
[Notices](notices.md#haiwake)). The runtime doesn't retry.

## Claude: `@haikit/anthropic`

### `anthropic`

```ts
function anthropic(options?: AnthropicOptions): ModelAdapter;
```

Returns an adapter that calls Claude through the Anthropic SDK
(`@anthropic-ai/sdk`, a dependency of the package).

```ts
import { anthropic } from "@haikit/anthropic";

const hai = createHai({ model: anthropic({ model: "claude-haiku-5-5", effort: "medium" }), … });
```

**What each `generate` call does:**

- **The SDK is loaded on the first call,** and a client is made then, with
  `apiKey` when it's a non-empty string. Every other setting, and the key when
  none is given, comes from the SDK's defaults: the `ANTHROPIC_API_KEY`,
  `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_BASE_URL` environment variables, up to
  2 retries of a request that fails before its stream starts, and a 10-minute
  timeout. With no key or token anywhere, the first call fails with the SDK's
  error, which becomes the turn's.
- **It streams a Messages API request** with:

  | Request field | Value |
  | --- | --- |
  | `model` | `options.model`, default `claude-haiku-5-5` |
  | `max_tokens` | `options.maxTokens`, default `16000` |
  | `output_config` | `{ effort: options.effort }`, default `"medium"` |
  | `system` | one text block holding `request.system`, marked `cache_control: { type: "ephemeral" }` |
  | `tools` | each tool's `name`, `description` and `input_schema`, plus `strict: true` when the tool's `strict` is truthy, which is the default for tools made with `defineTool`. `query_ui` has `strict: false` |
  | `messages` | `request.messages`, as they are |

- **Each text delta** in the stream goes to `onTextDelta`.
- **It returns** the final message's `content` and `stop_reason`.

The system prompt is the same on every call, and marked for caching, so
Claude's prompt cache can reuse it. Only `system` is marked: the conversation
history isn't. Keep anything that changes out of `system`.

The adapter's `id` is the model name, which the browser shows.

### `AnthropicOptions`

```ts
interface AnthropicOptions {
  model?: string;
  maxTokens?: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  apiKey?: string;
}
```

| Option | Default | Meaning |
| --- | --- | --- |
| `model` | `"claude-haiku-5-5"` | Any Claude model id, such as `"claude-sonnet-5-5"`. Also the adapter's `id` |
| `maxTokens` | `16000` | The reply's `max_tokens`. A reply that reaches it ends the turn, unless it was cut off part way through a tool call: that call isn't run, and the model is told and called again (see above) |
| `effort` | `"medium"` | Sent as `output_config.effort`. Lower is faster and cheaper |
| `apiKey` | the SDK's default (`ANTHROPIC_API_KEY`, or `ANTHROPIC_AUTH_TOKEN`) | The API key. An empty string counts as not given |

None of them is validated by the adapter: the API rejects what it doesn't
accept, and the turn fails with its error.

## OpenAI: `@haikit/openai`

### `openai`

```ts
function openai(options?: OpenAIOptions): ModelAdapter;
```

Returns an adapter that calls an OpenAI model through the OpenAI SDK
(`openai`, a dependency of the package), over the Responses API.

```ts
import { openai } from "@haikit/openai";

const hai = createHai({ model: openai({ model: "gpt-6-luna", effort: "medium" }), … });
```

**What each `generate` call does:**

- **The SDK is loaded on the first call,** and a client is made then, with
  `apiKey` and `baseURL` when each is a non-empty string. Every other
  setting, and the key and URL when none is given, comes from the SDK's
  defaults: the `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_ORG_ID` and
  `OPENAI_PROJECT_ID` environment variables, up to 2 retries of a request
  that fails before its stream starts, and a 10-minute timeout. With no key
  anywhere, the first call fails with the SDK's error, which becomes the
  turn's.
- **It streams a Responses API request** with:

  | Request field | Value |
  | --- | --- |
  | `model` | `options.model`, default `gpt-6-luna` |
  | `instructions` | `request.system` |
  | `tools` | each tool as `{ type: "function", name, description, parameters: input_schema, strict }`. `strict` is always sent: `true` only when the tool's `strict` is truthy and its schema [allows it](#strict-mode), and `false` otherwise. `query_ui` is `false` |
  | `input` | `request.messages`, translated (see [The history, sent](#the-history-sent)) |
  | `max_output_tokens` | `options.maxTokens`, default `16000` |
  | `store` | `false` |
  | `reasoning` | `{ effort: options.effort }`, default `"medium"`. Not sent when `effort` is `null` |
  | `include` | `["reasoning.encrypted_content"]`. Not sent when `effort` is `null` |
  | `prompt_cache_key` | `options.promptCacheKey`, sent only when it's a non-empty string |

- **Each text delta and refusal delta** in the stream goes to `onTextDelta`.
  Nothing else does: reasoning summaries and function-call arguments don't
  stream to the browser.
- **It returns** the final response, translated (see
  [The reply, returned](#the-reply-returned)).

Each call sends the whole history, with `store: false`, rather than chaining
calls with `previous_response_id`: OpenAI keeps nothing between calls, and
everything the model needs is in the request. The instructions and the tools
are the same on every call, so OpenAI's prompt cache, which matches on a
prefix and needs no marking, can reuse them. Keep anything that changes out of
`system`.

The adapter's `id` is the model name, which the browser shows.

#### The history, sent

Each message in `request.messages` becomes Responses API input items, in
order. `request.messages` isn't changed.

| In the history | Sent as |
| --- | --- |
| A message whose content is a string | `{ role, content }`, as it is |
| A user message's `text` block | `{ type: "input_text", text }`. The message's text blocks go together, as one `{ role: "user", content: [...] }` item |
| A user message's `tool_result` block | `{ type: "function_call_output", call_id: tool_use_id, output }`. A string `content` is the `output`, an array of `text` blocks is joined with newlines, and none is `""`. The message's results are sent before its text, because a call's output must follow the call: the runtime records notices' text after the results in the same message |
| An assistant message's `text` block | `{ role: "assistant", content: text }`. An empty one is left out |
| An assistant message's `tool_use` block | `{ type: "function_call", call_id: id, name, arguments: JSON.stringify(input) }`. That includes HaiKIT's init call, whose `toolu_init_…` id is sent as it is |
| An assistant message's `openai_reasoning` block | `{ type: "reasoning", id, summary, encrypted_content }`, as the reply gave it |

Anything else fails the call, and so the turn, with
`[haikit] openai: cannot send a "<type>" block in a <role> message to OpenAI`.
So do a block other than `text` inside a `tool_result`
(`… cannot send a "<type>" block in a tool_result to OpenAI`), and a message
or `tool_result` whose content is neither a string nor an array. That covers
blocks another adapter wrote, such as Claude's `thinking` blocks: a
conversation begun with `anthropic()` can't be continued with `openai()`.

#### The reply, returned

The response's `output` items become `content` blocks, in order:

| Output item | Becomes |
| --- | --- |
| A `message`'s `output_text` part | `{ type: "text", text }` |
| A `message`'s `refusal` part | `{ type: "text", text: refusal }` |
| A `function_call` | `{ type: "tool_use", id: call_id, name, input }`. `input` is `arguments` parsed as JSON. When they don't parse to an object, `input` is `{}` if the response is incomplete, as when it was cut off part way through the call: the runtime doesn't run an incomplete reply's calls. In a response that isn't incomplete, where the call would be run, the call fails instead (see below) |
| A `reasoning` item with `encrypted_content` | `{ type: "openai_reasoning", id, summary, encrypted_content }`, so the next call can send it back. One without `encrypted_content` is dropped, since with `store: false` there's nothing it could refer to |

Other output items are dropped: the adapter offers no built-in OpenAI tools,
so none should come back. The debug drawer shows `text`, `tool_use` and
`tool_result` blocks, so `openai_reasoning` blocks are in the history but not
shown there.

`stop_reason` is:

| The response | `stop_reason` |
| --- | --- |
| `status: "incomplete"` because of `max_output_tokens` | `"max_tokens"` |
| `status: "incomplete"` because of `content_filter` | `"refusal"` |
| `status: "incomplete"` for another reason | that reason, or `"incomplete"` when there's none |
| has a `function_call`, and isn't incomplete | `"tool_use"` |
| anything else | `"end_turn"` |

So a reply cut off part way through a tool call isn't run: the runtime
answers each of its calls with `Not run: …` and calls the model again (see
[How the runtime uses it](#how-the-runtime-uses-it)).

A response with `status: "failed"` or `"cancelled"` fails the call with
`[haikit] openai: the response <status>`, followed by `: <message>` when the
response has an error message. A function call whose arguments aren't a JSON
object, in a response that isn't incomplete, fails it with
`[haikit] openai: the model called <name> with arguments that aren't a JSON object`,
rather than run the tool on input the model didn't give. Either way the turn
fails, and the reply isn't recorded. The SDK's stream doesn't reject on these
itself. An error the API sends instead of a response, or one from the
network, rejects with the SDK's error.

#### Strict mode

A tool goes to OpenAI with `strict: true` only when its `strict` is truthy and
OpenAI's strict mode would accept its `input_schema`. The adapter checks one
rule: every object in the schema, at any depth, has
`additionalProperties: false` and lists every one of its `properties` in
`required`. A schema counts as an object when its `type` is or includes
`"object"`, or it has `properties`. The check looks through `properties`,
`items`, `anyOf`, `oneOf`, `allOf`, `$defs` and `definitions`.

A tool that fails it is sent with `strict: false`, quietly: sending
`strict: true` would make the API refuse the whole request. An optional
property is the usual reason. To keep strict mode for one, make it required
and allow `null` (`type: ["string", "null"]`).

Other limits of OpenAI's strict mode, such as keywords it doesn't support,
aren't checked: the API refuses the request, and the turn fails with its
error.

### `OpenAIOptions`

```ts
interface OpenAIOptions {
  model?: string;
  maxTokens?: number;
  effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null;
  apiKey?: string;
  baseURL?: string;
  promptCacheKey?: string;
}
```

| Option | Default | Meaning |
| --- | --- | --- |
| `model` | `"gpt-6-luna"` | Any OpenAI model id. Also the adapter's `id` |
| `maxTokens` | `16000` | The reply's `max_output_tokens`, which counts reasoning tokens as well as the reply's own. A reply that reaches it ends the turn, unless it was cut off part way through a tool call: that call isn't run, and the model is told and called again (see above) |
| `effort` | `"medium"` | Sent as `reasoning.effort`. Lower is faster and cheaper. Which values a model accepts is up to the model. `null` sends neither `reasoning` nor `include`, for a model that doesn't reason and refuses them, such as `gpt-4.1`; with it, no reasoning items come back |
| `apiKey` | the SDK's default (`OPENAI_API_KEY`) | The API key. An empty string counts as not given |
| `baseURL` | the SDK's default (`OPENAI_BASE_URL`, else `https://api.openai.com/v1`) | Where requests go, for a proxy or another host that serves the Responses API. An empty string counts as not given |
| `promptCacheKey` | none | Sent as `prompt_cache_key`, which OpenAI uses to route requests that share a prefix to the same cache. An empty string counts as not given |

None of them is validated by the adapter: the API rejects what it doesn't
accept, and the turn fails with its error.

## Writing an adapter

From HaiKIT, an adapter needs only `@haikit/core`'s types, never
`@haikit/server`. It must:

- **return `content` as an array, in the Messages API's shape.** The runtime
  records it in the history and sends the history back on the next call, so
  whatever an adapter returns, it gets back later. The runtime checks none of
  it: with `stop_reason: "tool_use"`, a `content` that isn't an array fails
  the turn.
- **give each tool call a unique `id`** in a `tool_use` block, with `name`
  and `input`, and return `stop_reason: "tool_use"` to have them run, and
  only then. With no `tool_use` block, the runtime ends the turn.
- **pass text to `onTextDelta`** as it arrives, or all at once, for the
  browser to show it.
- **leave `request.messages` unchanged.**
- **keep no state per conversation.** One adapter serves every conversation,
  and one conversation's calls can come from different requests, or from
  different servers sharing a store. Everything it needs is in the request.

The history also holds what the runtime writes itself: the init call, user
messages that are plain strings or text blocks, and `tool_result`s with
string content (see
[Conversations](conversations.md#what-haikit-writes-into-the-history)). An
adapter for another provider maps all of these, and its own replies, to and
from that provider's shapes, as `@haikit/openai` does. Blocks of its own, such
as `@haikit/openai`'s `openai_reasoning`, are recorded and sent back like any
other, but no other adapter knows them: a conversation stays with the adapter
that began it. A scripted adapter, one that answers from what's
in `messages` (the user's text and the tool results) without calling a model,
lets an app run and be tested with no API key. The examples each have one, in
`examples/*/src/server/scripted.ts`.
