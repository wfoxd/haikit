import type { ContentBlock } from "@modelcontextprotocol/client";
import type { McpResult } from "./index.js";

export interface TextOptions {
  /** The longest text returned, before the line saying it was cut. Default 8,000 (about 2,000 tokens). */
  maxChars?: number;
}

const MAX_CHARS = 8_000;

/**
 * A result as text, for a tool that decides to pass some of it on. Nothing
 * calls this for you: what a result becomes is the tool's choice.
 *
 * Text blocks, and resources embedded as text, come as they are; anything
 * else becomes one line saying what it was. With no content, the structured
 * result as JSON. Longer than `maxChars`, it is cut, and a last line says so:
 * a cut nobody mentions turns a cost problem into a correctness problem.
 */
export function textOf(result: McpResult, options: TextOptions = {}): string {
  const maxChars = options.maxChars ?? MAX_CHARS;
  if (!Number.isSafeInteger(maxChars) || maxChars < 0) {
    throw new RangeError(`maxChars must be a whole number of characters, 0 or more (got ${String(maxChars)})`);
  }
  const text =
    result.content.length === 0
      ? result.structuredContent === undefined
        ? ""
        : JSON.stringify(result.structuredContent)
      : result.content.map(blockText).join("\n");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n[Cut at ${maxChars} of ${text.length} characters.]`;
}

function blockText(block: ContentBlock): string {
  switch (block.type) {
    case "text":
      return block.text;
    case "image":
    case "audio":
      return `[${block.type}: ${block.mimeType}, ${bytes(block.data)} bytes, not included]`;
    case "resource_link":
      return `[resource link: ${block.name} ${block.uri}]`;
    case "resource": {
      const r = block.resource;
      if ("text" in r && typeof r.text === "string") return r.text;
      const blob = "blob" in r && typeof r.blob === "string" ? r.blob : "";
      return `[resource: ${r.uri}${r.mimeType ? `, ${r.mimeType}` : ""}, ${bytes(blob)} bytes, not included]`;
    }
    default:
      // a content type from a later protocol revision
      return `[${String((block as { type?: unknown }).type)} content, not included]`;
  }
}

/** The size of what base64 `data` encodes, without decoding it. */
function bytes(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}
