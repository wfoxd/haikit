import {
  estTokens,
  makeCap,
  type AnySurfaceImpl,
  type Conversation,
  type Emit,
  type ModelAdapter,
  type StoreAdapter,
  type Tool,
  type ToolCtx,
  type ToolReturn,
} from "@haikit/core";

export interface HaiConfig {
  model: ModelAdapter;
  store: StoreAdapter;
  system: string;
  tools: Tool[];
  surfaces: AnySurfaceImpl[];
  /** Guard against runaway tool loops. */
  maxHops?: number;
  /** Turn lease duration; a dead process releases after this. */
  leaseMs?: number;
}

const LEASE_MS = 120_000;

export class Hai {
  readonly config: HaiConfig;
  private readonly surfaces = new Map<string, AnySurfaceImpl>();
  private readonly tools = new Map<string, Tool>();
  private seq = 0;

  constructor(config: HaiConfig) {
    this.config = config;
    for (const s of config.surfaces) this.surfaces.set(s.surface.name, s);
    for (const t of config.tools) this.tools.set(t.name, t);
    // query_ui is DERIVED, never authored. It cannot drift from the surfaces
    // that actually exist, and it always exists.
    const queryUi = this.buildQueryUiTool();
    this.tools.set(queryUi.name, queryUi);
  }

  private nid(prefix: string) {
    return `${prefix}_${++this.seq}`;
  }

  // ───────────────────────────────────────────────── derived tool

  private buildQueryUiTool(): Tool<any> {
    const catalogue = [...this.surfaces.values()]
      .map((s) => {
        const names = Object.keys(s.surface.queries);
        return names.length ? `${s.surface.name}: ${names.join(", ")}` : null;
      })
      .filter(Boolean)
      .join(" · ");

    const self = this;
    return {
      name: "query_ui",
      description:
        "Dereference a rendered component's full dataset. The digest in your context holds only " +
        "highlights; use this for anything beyond it. Never guess about rows you have not seen. " +
        (catalogue ? `Available queries — ${catalogue}.` : ""),
      input: { parse: (v) => v as any },
      inputJsonSchema: {
        type: "object",
        properties: {
          handle: { type: "string", description: "e.g. ui_01" },
          query: { type: "string" },
          args: { type: "object" },
        },
        required: ["handle", "query"],
      },
      strict: false,
      async run(input: { handle: string; query: string; args?: unknown }, ctx) {
        const record = await self.config.store.getPayload(input.handle, ctx.conversationId);
        if (!record) return ctx.text(`No such handle: ${input.handle}`);

        const impl = self.surfaces.get(record.component);
        const handler = impl?.impl.queries?.[input.query];
        if (!impl || !handler) {
          const available = impl ? Object.keys(impl.surface.queries).join(", ") : "none";
          return ctx.text(`Unsupported query "${input.query}". Available: ${available || "none"}.`);
        }

        const spec = impl.surface.queries[input.query];
        let args: unknown;
        try {
          args = spec.input.parse(input.args ?? {});
        } catch (err) {
          return ctx.text(`Invalid args for "${input.query}": ${(err as Error).message}`);
        }

        const rows = (record.props as any)?.[primaryCollection(record.props)] ?? [];
        const capped = handler(args, { props: record.props, cap: makeCap(rows.length) });
        return ctx.text(capped.text);
      },
    };
  }

  // ─────────────────────────────────────────────────── public API

  async send(conversation: Conversation, text: string, emit: Emit): Promise<void> {
    // The user typed while a tool was parked. Every tool_use in a turn must
    // receive a tool_result, so close the pending one out honestly first.
    if (conversation.status === "awaiting" && conversation.pending) {
      const { toolUseId, handle, results, digest } = conversation.pending;
      await this.config.store.freezePayload(handle);
      emit({ type: "ui_state", handle, state: "frozen" });
      conversation.messages.push({
        role: "user",
        content: [
          ...results,
          {
            type: "tool_result",
            tool_use_id: toolUseId,
            content: `${digest}\nUser did not select; they said: "${text}"`,
          },
        ],
      });
      conversation.pending = null;
    }

    emit({ type: "block_start", block: { kind: "user", id: this.nid("b"), text } });
    conversation.messages.push({ role: "user", content: text });
    await this.runTurn(conversation, emit);
  }

  async interact(
    conversation: Conversation,
    input: { handle: string; action: string; value: unknown },
    emit: Emit,
  ): Promise<void> {
    const record = await this.config.store.getPayload(input.handle, conversation.id);
    if (!record) throw new Error("unknown handle");
    if (record.state === "frozen") throw new Error("component is frozen");

    const impl = this.surfaces.get(record.component);
    if (!impl) throw new Error(`unknown component: ${record.component}`);

    // GUARANTEE 4 in force at runtime: the client sent {handle, action, value}.
    // What that action MEANS is decided here, from the declared contract.
    const spec = impl.surface.actions[input.action];
    const handler = impl.impl.actions?.[input.action];
    if (!spec || !handler) throw new Error("unbound action");

    let value: unknown;
    try {
      value = spec.input.parse(input.value);
    } catch (err) {
      throw new Error(`invalid action payload: ${(err as Error).message}`);
    }

    const label = handler(value, { props: record.props, handle: record.handle });

    if (spec.kind === "resolve") {
      if (conversation.pending?.handle !== input.handle) throw new Error("nothing awaiting this handle");
      await this.config.store.freezePayload(input.handle);
      emit({ type: "ui_state", handle: input.handle, state: "frozen", selection: value });
      emit({ type: "block_start", block: { kind: "interaction", id: this.nid("b"), handle: input.handle, label } });

      conversation.messages.push({
        role: "user",
        content: [
          ...conversation.pending.results,
          {
            type: "tool_result",
            tool_use_id: conversation.pending.toolUseId,
            // The digest rides along: this elicit tool never got a tool_result,
            // so nothing about the search has reached the model yet.
            content: `${conversation.pending.digest}\n${label}`,
          },
        ],
      });
      conversation.pending = null;
      return this.runTurn(conversation, emit);
    }

    // inform: enriches the conversation without having blocked it
    emit({ type: "block_start", block: { kind: "interaction", id: this.nid("b"), handle: input.handle, label } });
    conversation.messages.push({ role: "user", content: `[UI interaction] ${label}` });
    return this.runTurn(conversation, emit);
  }

  // ──────────────────────────────────────────────── the agent loop

  private async runTurn(conversation: Conversation, emit: Emit): Promise<void> {
    conversation.status = "streaming";
    conversation.leaseUntil = Date.now() + (this.config.leaseMs ?? LEASE_MS);
    emit({ type: "status", status: "streaming" });

    const toolDefs = [...this.tools.values()].map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputJsonSchema,
      strict: t.strict,
    }));

    for (let hop = 0; hop < (this.config.maxHops ?? 8); hop++) {
      const blockId = this.nid("b");
      let opened = false;

      const final = await this.config.model.generate({
        system: this.config.system,
        tools: toolDefs,
        messages: conversation.messages,
        onTextDelta: (text) => {
          if (!opened) {
            opened = true;
            emit({ type: "block_start", block: { kind: "assistant", id: blockId, text: "" } });
          }
          emit({ type: "text_delta", id: blockId, text });
        },
      });

      conversation.messages.push({ role: "assistant", content: final.content });
      if (final.stop_reason !== "tool_use") break;

      const results: unknown[] = [];
      let parked: { toolUseId: string; handle: string; digest: string } | null = null;

      for (const call of final.content.filter((b: any) => b?.type === "tool_use")) {
        const toolBlockId = this.nid("b");
        emit({
          type: "block_start",
          block: { kind: "tool", id: toolBlockId, name: call.name, input: call.input, status: "running" },
        });

        const started = Date.now();
        const { ret, mode } = await this.invokeTool(conversation, call, emit, toolBlockId);
        const ms = Date.now() - started;

        if (mode === "elicit" && ret.handle) {
          emit({ type: "block_update", id: toolBlockId, status: "awaiting", ms, result: ret.model });
          parked = { toolUseId: call.id, handle: ret.handle, digest: ret.model };
        } else {
          emit({ type: "block_update", id: toolBlockId, status: "ok", ms, result: ret.model });
          results.push({ type: "tool_result", tool_use_id: call.id, content: ret.model });
        }
      }

      if (parked) {
        // Hold the resolved siblings too — the API is all-or-nothing per batch.
        conversation.status = "awaiting";
        conversation.pending = { ...parked, results };
        conversation.leaseUntil = null;
        emit({ type: "status", status: "awaiting" });
        await this.emitContext(conversation, emit);
        return;
      }

      conversation.messages.push({ role: "user", content: results });
    }

    conversation.status = "idle";
    conversation.leaseUntil = null;
    emit({ type: "status", status: "idle" });
    await this.emitContext(conversation, emit);
  }

  private async invokeTool(
    conversation: Conversation,
    call: any,
    emit: Emit,
    toolBlockId: string,
  ): Promise<{ ret: ToolReturn; mode: "display" | "elicit" | null }> {
    const tool = this.tools.get(call.name);
    if (!tool) return { ret: { model: `Unknown tool: ${call.name}` }, mode: null };

    let mode: "display" | "elicit" | null = null;

    const ctx: ToolCtx = {
      conversationId: conversation.id,
      text: (model) => ({ model }),
      render: (async (impl: AnySurfaceImpl, props: unknown, options?: { mode?: "display" | "elicit" }) => {
        const surfaceMode = options?.mode ?? "display";
        mode = surfaceMode;

        // Validate before storing: props may originate outside this process.
        const parsed = impl.surface.props.parse(props);

        const handle = await this.config.store.putPayload({
          conversationId: conversation.id,
          component: impl.surface.name,
          version: impl.surface.version,
          props: parsed,
          mode: surfaceMode,
          state: "live",
        });

        conversation.handles.push(handle);

        // The split, in two lines. Digest -> model. Payload -> browser.
        const digest = impl.impl.digest(parsed, { handle });
        emit({
          type: "ui_open",
          handle,
          toolId: toolBlockId,
          component: impl.surface.name,
          version: impl.surface.version,
          mode: surfaceMode,
        });
        emit({ type: "ui_props", handle, props: parsed });

        return { model: digest, handle };
      }) as ToolCtx["render"],
    };

    let input: unknown;
    try {
      input = tool.input.parse(call.input);
    } catch (err) {
      return { ret: { model: `Invalid input for ${call.name}: ${(err as Error).message}` }, mode: null };
    }

    try {
      const ret = await tool.run(input, ctx);
      return { ret, mode };
    } catch (err) {
      return { ret: { model: `${call.name} failed: ${(err as Error).message}` }, mode: null };
    }
  }

  private async emitContext(conversation: Conversation, emit: Emit) {
    let uiTokens = 0;
    for (const handle of conversation.handles) {
      const record = await this.config.store.getPayload(handle, conversation.id);
      if (record) uiTokens += estTokens(record.props);
    }
    emit({
      type: "context",
      messages: conversation.messages,
      modelTokens: estTokens(conversation.messages),
      uiTokens,
    });
  }
}

/** Find the array prop a surface's queries operate over (for cap totals). */
function primaryCollection(props: unknown): string {
  if (props && typeof props === "object") {
    for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
      if (Array.isArray(value)) return key;
    }
  }
  return "";
}
