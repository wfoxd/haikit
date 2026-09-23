import type { ModelAdapter, ModelRequest, ModelResponse } from "@haikit/core";

/**
 * Anthropic model adapter.
 *
 * Note it imports only hai-core, never hai-server. Adapters implement an
 * interface the contract layer declares; that is what keeps the runtime
 * swappable, and what lets an app ship its own adapter (see the scripted model
 * in apps/flights) without forking the framework.
 *
 * The agent loop is hand-written rather than using the SDK's tool runner: an
 * `elicit` turn must stop mid-turn, return an HTTP response, and resume from a
 * *different request* minutes later. An in-process iterator cannot cross that.
 */
export interface AnthropicOptions {
  model?: string;
  maxTokens?: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  apiKey?: string;
}

export function anthropic(options: AnthropicOptions = {}): ModelAdapter {
  const model = options.model ?? "claude-opus-5";
  let client: any = null;

  return {
    id: model,

    async generate(request: ModelRequest): Promise<ModelResponse> {
      if (!client) {
        const { default: Anthropic } = await import("@anthropic-ai/sdk");
        client = options.apiKey ? new Anthropic({ apiKey: options.apiKey }) : new Anthropic();
      }

      const stream = client.messages.stream({
        model,
        max_tokens: options.maxTokens ?? 16000,
        output_config: { effort: options.effort ?? "medium" },
        // Stable prefix, cached: prompt caching is a prefix match, so nothing
        // volatile may go in here.
        system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
        tools: request.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema,
          ...(t.strict ? { strict: true } : {}),
        })),
        messages: request.messages,
      });

      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          request.onTextDelta(event.delta.text);
        }
      }

      const final = await stream.finalMessage();
      return { content: final.content, stop_reason: final.stop_reason };
    },
  };
}
