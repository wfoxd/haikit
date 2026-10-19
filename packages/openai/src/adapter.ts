import type { ModelAdapter, ModelRequest, ModelResponse } from "@haikit/core";
import { fromOutput, toInput, toTools } from "./mapping.js";

/**
 * OpenAI model adapter, over the Responses API.
 *
 * Note it imports only hai-core, never hai-server. Adapters implement an
 * interface the contract layer declares; that is what keeps the runtime
 * swappable, and what lets an app ship its own adapter without forking the
 * framework.
 *
 * It sends the whole history on every call with `store: false`, rather than
 * chaining `previous_response_id`: the conversation lives in the app's store,
 * which HaiKIT itself writes into between calls, and one conversation's calls
 * can come from different servers.
 */
export interface OpenAIOptions {
  /** Any OpenAI model ID. Defaults to `gpt-6-luna`. */
  model?: string;
  maxTokens?: number;
  /** Defaults to `medium`. */
  effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  apiKey?: string;
  baseURL?: string;
  /** Sent as `prompt_cache_key`, to route calls that share a prefix together. */
  promptCacheKey?: string;
}

/** The adapter, given a way to make the client: tests pass a fake one. */
export function createAdapter(options: OpenAIOptions, makeClient: () => Promise<any>): ModelAdapter {
  const model = options.model ?? "gpt-6-luna";
  let client: any = null;

  return {
    id: model,

    async generate(request: ModelRequest): Promise<ModelResponse> {
      if (!client) client = await makeClient();

      const stream = client.responses.stream({
        model,
        // Stable prefix: OpenAI caches it on its own, so nothing volatile may
        // go in here.
        instructions: request.system,
        tools: toTools(request.tools),
        input: toInput(request.messages),
        max_output_tokens: options.maxTokens ?? 16000,
        reasoning: { effort: options.effort ?? "medium" },
        store: false,
        include: ["reasoning.encrypted_content"],
        ...(options.promptCacheKey ? { prompt_cache_key: options.promptCacheKey } : {}),
      });

      for await (const event of stream) {
        if (event.type === "response.output_text.delta" || event.type === "response.refusal.delta") {
          request.onTextDelta(event.delta);
        }
      }

      return fromOutput(await stream.finalResponse());
    },
  };
}
