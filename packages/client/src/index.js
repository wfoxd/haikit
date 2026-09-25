/**
 * hai-client — the browser runtime.
 *
 * Headless: it owns the transport, the block store, and surface mounting.
 * It does NOT own how your transcript looks — see transcript.js for a default
 * renderer you are expected to replace.
 *
 * Note this package has no dependency on hai-server. The only thing crossing
 * that line is your surface contract, and on this side it crosses as types.
 */

/**
 * @param {{endpoint?: string, registry: Record<string, {mount: Function}>}} options
 */
export function createChat({ endpoint = "/hai", registry }) {
  const listeners = new Set();
  const state = {
    conversationId: null,
    model: "",
    status: "idle",
    blocks: [],
    /** handle -> { component, version, mode, props, state, instance } */
    surfaces: new Map(),
    context: { messages: [], modelTokens: 0, uiTokens: 0 },
  };

  const notify = (event) => listeners.forEach((fn) => fn(state, event));

  // ── transport: SSE over POST (EventSource cannot POST) ──────────────
  async function stream(path, body) {
    const res = await fetch(endpoint + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId: state.conversationId, ...body }),
    });

    // A non-SSE response carries no `data:` frames, so parsing it as a stream
    // would fail silently and the UI would just sit there. 409 is the server
    // refusing a second concurrent turn on this conversation.
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      apply({
        type: "error",
        message:
          detail.error ??
          (res.status === 409 ? "another turn is already in flight" : `request failed (${res.status})`),
      });
      return;
    }

    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let i;
      while ((i = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        const line = frame.split("\n").find((l) => l.startsWith("data: "));
        if (line) apply(JSON.parse(line.slice(6)));
      }
    }
  }

  function apply(event) {
    switch (event.type) {
      case "hello":
        state.conversationId = event.conversationId;
        state.model = event.model;
        break;

      case "block_start":
        state.blocks.push({ ...event.block });
        break;

      case "text_delta": {
        const block = state.blocks.find((b) => b.id === event.id);
        if (block) block.text += event.text;
        break;
      }

      case "block_update": {
        const block = state.blocks.find((b) => b.id === event.id);
        if (block) Object.assign(block, event);
        break;
      }

      case "ui_open":
        state.surfaces.set(event.handle, {
          handle: event.handle,
          component: event.component,
          version: event.version,
          mode: event.mode,
          state: "live",
          props: null,
          instance: null,
        });
        state.blocks.push({ kind: "ui", id: `ui:${event.handle}`, handle: event.handle, toolId: event.toolId });
        break;

      case "ui_props": {
        const surface = state.surfaces.get(event.handle);
        if (surface) surface.props = event.props;
        break;
      }

      case "ui_state": {
        const surface = state.surfaces.get(event.handle);
        if (surface) {
          surface.state = event.state;
          surface.instance?.freeze?.(event.selection);
        }
        break;
      }

      case "status":
        state.status = event.status;
        break;

      case "context":
        state.context = event;
        break;

      case "error":
        state.blocks.push({ kind: "error", id: `e${state.blocks.length}`, message: event.message });
        state.status = "idle";
        break;
    }
    notify(event);
  }

  /**
   * Mount a surface into an element. Strict allowlist: an unregistered
   * component renders an error card, never an improvised UI.
   */
  function mount(handle, element) {
    const surface = state.surfaces.get(handle);
    if (!surface || !surface.props) return null;

    const definition = registry[surface.component];
    if (!definition) {
      element.textContent = `unknown component: ${surface.component}`;
      element.className = "hai-surface-error";
      return null;
    }

    element.replaceChildren();
    surface.instance = definition.mount(element, surface.props, {
      handle,
      mode: surface.mode,
      state: surface.state,
      // The ONLY channel a component has to the server. It passes an action
      // name declared in the contract — never a tool, never a handler.
      send: (action, value) => interact(handle, action, value),
    });
    return surface.instance;
  }

  async function send(text) {
    if (!text.trim() || state.status === "streaming") return;
    await stream("/chat", { message: text });
  }

  async function interact(handle, action, value) {
    if (state.status === "streaming") return;
    await stream("/interact", { handle, action, value });
  }

  return {
    state,
    send,
    interact,
    mount,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
