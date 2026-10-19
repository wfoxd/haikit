import type { ModelAdapter } from "@haikit/core";
import { createAdapter, type OpenAIOptions } from "./adapter.js";

export type { OpenAIOptions };

export function openai(options: OpenAIOptions = {}): ModelAdapter {
  return createAdapter(options, async () => {
    const { default: OpenAI } = await import("openai");
    return new OpenAI({
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    });
  });
}
