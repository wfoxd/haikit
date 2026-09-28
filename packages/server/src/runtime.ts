import {
  estTokens,
  isStaleLease,
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
}

export class Hai {
  readonly config: HaiConfig;
  private readonly surfaces = new Map<string, AnySurfaceImpl>();
  private readonly tools = new Map<string, Tool>();
  private seq = 0;

  constructor(config: HaiConfig) {
    this.config = config;
    for (const s of config.surfaces) {
      checkWindow(s);
      this.surfaces.set(s.surface.name, s);
    }
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
    // The model has to be told what each query TAKES, not just that it exists.
    // Listing bare names leaves `args` opaque, and the model then calls the
    // query with none — every filter becomes a no-op and it gets the whole
    // collection back.
    const entries = [...this.surfaces.values()].flatMap((s) =>
      Object.entries(s.surface.queries).map(([name, spec]) => {
        const parts = [`${s.surface.name}.${name}`];
        if (spec.description) parts.push(`— ${spec.description}`);
        parts.push(
          spec.argsJsonSchema
            ? `args: ${JSON.stringify(spec.argsJsonSchema)}`
            : "args: (undeclared — omit them)",
        );
        return { surface: s.surface.name, name, spec, line: parts.join(" ") };
      }),
    );

    // A query whose args are invisible is a silent wrong-answer bug, not a
    // missing nicety — say so once, at construction, rather than never.
    const undeclared = entries.filter((e) => !e.spec.argsJsonSchema);
    if (undeclared.length) {
      console.warn(
        `[haikit] query_ui: no argsJsonSchema for ${undeclared.map((e) => `${e.surface}.${e.name}`).join(", ")}. ` +
          `The model cannot see these parameters and will call the query with no arguments. ` +
          `A query that genuinely takes none should declare { type: "object", properties: {} }.`,
      );
    }

    const catalogue = entries.map((e) => `- ${e.line}`).join("\n");

    const self = this;
    return {
      name: "query_ui",
      description:
        "Dereference a rendered component's full dataset. The digest in your context holds only " +
        "highlights; use this for anything beyond it. Never guess about rows you have not seen. " +
        (catalogue ? `\n\nAvailable queries:\n${catalogue}` : ""),
      input: { parse: (v) => v as any },
      inputJsonSchema: {
        type: "object",
        properties: {
          handle: { type: "string", description: "e.g. ui_01" },
          query: { type: "string", description: "One of the query names listed in the description." },
          args: {
            type: "object",
            description:
              "Arguments for the chosen query, matching that query's schema in the description. " +
              "Pass the constraints the user actually asked for — omitting them matches everything.",
          },
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
    if (await this.refuseIfExpired(conversation, emit)) return;

    // The user typed while a tool was parked. Every tool_use in a turn must
    // receive a tool_result, so close the pending one out honestly first.
    if (conversation.status === "awaiting" && conversation.pending) {
      const { toolUseId, handle, results, digest } = conversation.pending;
      // Recorded on the conversation, not the payload, so it commits with the
      // history that explains it — see Conversation.frozen.
      conversation.frozen.push(handle);
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
    if (await this.refuseIfExpired(conversation, emit)) return;

    // The payload row carries a conversation id, but that alone is not enough.
    // A turn that rendered a surface and was then overtaken leaves a row behind:
    // its conversation save is rejected, so the winning history never records
    // the handle, yet the row and the browser that mounted it both still exist.
    // Membership of the surviving `handles` is what makes those orphans inert.
    if (!conversation.handles.includes(input.handle)) throw new Error("unknown handle");

    if (conversation.frozen.includes(input.handle)) throw new Error("component is frozen");

    const record = await this.config.store.getPayload(input.handle, conversation.id);
    if (!record) throw new Error("unknown handle");

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
      conversation.frozen.push(input.handle);
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

  /**
   * Refuse any request on a conversation that has outlived one of its surfaces.
   *
   * Runs first, before anything is changed, so a refused request records
   * nothing and costs no model call — the save that follows only releases the
   * lease. Every handle in the surviving history counts, answered ones
   * included: what the user picked from a surface is still in the model's
   * context at the price it was shown at.
   *
   * A payload held to a window whose age cannot be computed counts as expired.
   * A store returning a bad `createdAt` has to fail closed, not quietly make
   * every surface fresh forever. A `"never"` window needs no age, so its
   * timestamp is not consulted — the conformance suite is what holds a store
   * to returning good ones. A payload whose row is gone counts as expired too:
   * nothing deletes a payload the history still references, so a missing one
   * is lost data, and lost data proves nothing is fresh.
   */
  private async refuseIfExpired(conversation: Conversation, emit: Emit): Promise<boolean> {
    if (!conversation.handles.length) return false;
    const now = Date.now();
    const records = await this.config.store.getPayloads(conversation.handles, conversation.id);

    // the surface that went out of date first is the one that closed it
    let first: { expiredAt: number; age: number; window: number | undefined } | null = null;

    // getPayloads omits handles it cannot find, and the loop below only sees
    // what came back — so a missing row has to be caught here
    const found = new Set(records.map((r) => r.handle));
    if (conversation.handles.some((h) => !found.has(h))) {
      first = { expiredAt: Number.NaN, age: Number.NaN, window: undefined };
    }

    for (const record of records) {
      // a surface the code no longer registers has no current window at all,
      // which is not the same as one registered without a window ("never")
      const impl = this.surfaces.get(record.component);
      const window = strictest(record.staleAfterMs, impl ? windowOf(impl) : undefined);
      if (window === "never") continue;
      // A timestamp that is not a finite number cannot prove anything is fresh:
      // Infinity would compare fresh forever, and a bigint would throw on the
      // arithmetic. Replace it before doing any, so each counts as expired —
      // and so does a payload whose window is known nowhere.
      const createdAt = Number.isFinite(record.createdAt) ? record.createdAt : Number.NaN;
      const expiredAt = createdAt + (window ?? Number.NaN);
      if (expiredAt > now) continue;
      if (!first || expiredAt < first.expiredAt) first = { expiredAt, age: now - createdAt, window };
    }
    if (!first) return false;

    const shown = Number.isFinite(first.age) ? `results shown ${duration(first.age)} ago` : "results shown here";
    const verdict =
      first.window === undefined ? "can no longer be checked" : `were only valid for ${duration(first.window)}`;
    emit({
      type: "expired",
      message: `This conversation is out of date — ${shown} ${verdict}. Start a new conversation for current results.`,
    });
    return true;
  }

  // ──────────────────────────────────────────────── the agent loop

  private async runTurn(conversation: Conversation, emit: Emit): Promise<void> {
    conversation.status = "streaming";
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
        emit({ type: "status", status: "awaiting" });
        await this.emitContext(conversation, emit);
        return;
      }

      conversation.messages.push({ role: "user", content: results });
    }

    conversation.status = "idle";
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
        const window = windowOf(impl);

        const handle = await this.config.store.putPayload(
          {
            conversationId: conversation.id,
            component: impl.surface.name,
            version: impl.surface.version,
            props: parsed,
            mode: surfaceMode,
            // recorded now, so no later deploy can relax the window this data
            // was shown under — see the stricter-of in refuseIfExpired
            staleAfterMs: window,
          },
          conversation.leaseToken,
        );

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
          // so a browser left open can close the conversation on time, rather
          // than only finding out when its next request is refused
          ...(window === "never" ? {} : { staleAfterMs: window }),
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
      // A tool error is information for the model; a lost lease is not. Fencing
      // exists so a superseded turn stops — converting StaleLease into "tool
      // failed" would hand it back to the model and keep paying for hops whose
      // output the fenced save is going to discard anyway.
      if (isStaleLease(err)) throw err;
      return { ret: { model: `${call.name} failed: ${(err as Error).message}` }, mode: null };
    }
  }

  private async emitContext(conversation: Conversation, emit: Emit) {
    // One batched read, not one per handle: this runs on every turn, and a
    // conversation accumulates handles for as long as it lives.
    const records = await this.config.store.getPayloads(conversation.handles, conversation.id);
    let uiTokens = 0;
    for (const record of records) uiTokens += estTokens(record.props);
    emit({
      type: "context",
      messages: conversation.messages,
      modelTokens: estTokens(conversation.messages),
      uiTokens,
    });
  }
}

/**
 * A surface's declared window; one that declares none never goes stale. Only a
 * missing field defaults — `null` is not "no window" but an invalid one, and
 * has to reach checkWindow to be refused like any other.
 */
const windowOf = (s: AnySurfaceImpl): number | "never" =>
  s.impl.staleAfterMs === undefined ? "never" : s.impl.staleAfterMs;

/**
 * The type checked again at runtime, because JavaScript callers never see it.
 * Zero or less would expire every surface the moment it rendered; NaN never
 * compares as expired, and Infinity means "never" without saying so. Leaving
 * the window out is fine: that is "never".
 */
function checkWindow(s: AnySurfaceImpl) {
  const window: unknown = windowOf(s);
  if (window === "never" || (typeof window === "number" && Number.isFinite(window) && window > 0)) return;
  const got = typeof window === "string" ? JSON.stringify(window) : String(window);
  throw new RangeError(
    `surface ${s.surface.name}: staleAfterMs must be a positive, finite number of milliseconds, ` +
      `or "never" (got ${got})`,
  );
}

/**
 * The window a payload is held to: the stricter of the one recorded when it
 * rendered and the one the code declares now. Recorded is what the data was
 * shown under, and survives the surface being renamed or removed; current
 * catches a window tightened since. Neither may relax the other. Undefined
 * when neither is known — an old payload whose surface is gone — which the
 * caller counts as expired.
 */
function strictest(recorded: unknown, current: unknown): number | "never" | undefined {
  const valid = (w: unknown): w is number | "never" =>
    w === "never" || (typeof w === "number" && Number.isFinite(w) && w > 0);
  const known = [recorded, current].filter(valid);
  if (!known.length) return undefined;
  const finite = known.filter((w): w is number => w !== "never");
  return finite.length ? Math.min(...finite) : "never";
}

/** "2 hours", "15 minutes" — for a sentence a person reads. */
function duration(ms: number): string {
  const units: [number, string][] = [
    [86_400_000, "day"],
    [3_600_000, "hour"],
    [60_000, "minute"],
    [1_000, "second"],
  ];
  for (const [size, name] of units) {
    if (ms >= size) {
      const n = Math.floor(ms / size);
      return `${n} ${name}${n === 1 ? "" : "s"}`;
    }
  }
  return "under a second";
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
