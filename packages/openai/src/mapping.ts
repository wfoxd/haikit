import type { Message, ModelRequest, ModelResponse } from "@haikit/core";

/**
 * The history is kept in the Anthropic Messages shape, so this adapter's work
 * is translation: the history into Responses API input items on the way out,
 * and the response's output items back into content blocks on the way in.
 * Everything here is pure, so it can be tested without the network.
 */

/** A reasoning item kept in the history so the next call can send it back. */
export const REASONING_BLOCK = "openai_reasoning";

function refuse(what: string): never {
  throw new Error(`[haikit] openai: cannot send ${what} to OpenAI`);
}

/** A `tool_result`'s content, as the single string `function_call_output` takes. */
function resultText(content: unknown): string {
  if (content === undefined || content === null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b: any) => (b?.type === "text" && typeof b.text === "string" ? b.text : refuse(`a "${b?.type}" block in a tool_result`)))
      .join("\n");
  }
  return refuse("a tool_result whose content is not a string or an array");
}

export function toInput(messages: readonly Message[]): any[] {
  const input: any[] = [];

  for (const message of messages) {
    const { role, content } = message;

    if (typeof content === "string") {
      input.push({ role, content });
      continue;
    }
    if (!Array.isArray(content)) refuse(`a ${role} message whose content is not a string or an array`);

    if (role === "user") {
      // A function call's output must follow the call, so the results go
      // first: the runtime puts notices' text after them in the same message.
      const texts: any[] = [];
      for (const block of content) {
        if (block?.type === "tool_result") {
          input.push({ type: "function_call_output", call_id: block.tool_use_id, output: resultText(block.content) });
        } else if (block?.type === "text") {
          texts.push({ type: "input_text", text: block.text });
        } else {
          refuse(`a "${block?.type}" block in a user message`);
        }
      }
      if (texts.length > 0) input.push({ role: "user", content: texts });
      continue;
    }

    for (const block of content) {
      if (block?.type === "text") {
        if (block.text) input.push({ role: "assistant", content: block.text });
      } else if (block?.type === "tool_use") {
        input.push({ type: "function_call", call_id: block.id, name: block.name, arguments: JSON.stringify(block.input ?? {}) });
      } else if (block?.type === REASONING_BLOCK) {
        input.push({ type: "reasoning", id: block.id, summary: block.summary ?? [], encrypted_content: block.encrypted_content });
      } else {
        refuse(`a "${block?.type}" block in an assistant message`);
      }
    }
  }

  return input;
}

/**
 * Whether OpenAI's strict mode accepts this schema: every object lists all of
 * its properties in `required` and sets `additionalProperties: false`, all the
 * way down. Sending `strict: true` on a schema that doesn't would fail the
 * whole turn, so such a tool goes without strict mode instead.
 */
export function isStrictCompatible(schema: unknown): boolean {
  if (schema === null || typeof schema !== "object") return true;
  if (Array.isArray(schema)) return schema.every(isStrictCompatible);
  const s = schema as Record<string, any>;

  const isObject = s.type === "object" || (Array.isArray(s.type) && s.type.includes("object")) || "properties" in s;
  if (isObject) {
    if (s.additionalProperties !== false) return false;
    const keys = Object.keys(s.properties ?? {});
    const required: unknown[] = Array.isArray(s.required) ? s.required : [];
    if (!keys.every((k) => required.includes(k))) return false;
  }

  for (const key of ["properties", "$defs", "definitions"]) {
    if (s[key] && typeof s[key] === "object" && !Object.values(s[key]).every(isStrictCompatible)) return false;
  }
  for (const key of ["items", "anyOf", "oneOf", "allOf"]) {
    if (s[key] !== undefined && !isStrictCompatible(s[key])) return false;
  }
  return true;
}

export function toTools(tools: ModelRequest["tools"]): any[] {
  return tools.map((t) => ({
    type: "function",
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
    // Sent either way, so the API's own default never decides.
    strict: Boolean(t.strict) && isStrictCompatible(t.input_schema),
  }));
}

function parseArguments(text: unknown): Record<string, unknown> {
  try {
    const value = JSON.parse(String(text));
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export function fromOutput(response: any): ModelResponse {
  // The SDK's stream resolves a failed response rather than throwing, and
  // returning it would end the turn as if the model had nothing to say.
  if (response?.status === "failed" || response?.status === "cancelled") {
    const why = response.error?.message ? `: ${response.error.message}` : "";
    throw new Error(`[haikit] openai: the response ${response.status}${why}`);
  }

  const content: any[] = [];

  for (const item of response?.output ?? []) {
    if (item?.type === "message") {
      for (const part of item.content ?? []) {
        if (part?.type === "output_text") content.push({ type: "text", text: part.text });
        else if (part?.type === "refusal") content.push({ type: "text", text: part.refusal });
      }
    } else if (item?.type === "function_call") {
      content.push({ type: "tool_use", id: item.call_id, name: item.name, input: parseArguments(item.arguments) });
    } else if (item?.type === "reasoning" && item.encrypted_content) {
      // With `store: false`, OpenAI keeps nothing, so a reasoning item can only
      // be sent back with its encrypted content. One without it is dropped.
      content.push({ type: REASONING_BLOCK, id: item.id, summary: item.summary ?? [], encrypted_content: item.encrypted_content });
    }
  }

  return { content, stop_reason: stopReason(response, content) };
}

function stopReason(response: any, content: any[]): string {
  if (response?.status === "incomplete") {
    const reason = response.incomplete_details?.reason;
    if (reason === "max_output_tokens") return "max_tokens";
    if (reason === "content_filter") return "refusal";
    return reason ?? "incomplete";
  }
  return content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn";
}
