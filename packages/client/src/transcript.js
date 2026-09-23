/**
 * A default transcript renderer. Deliberately plain — data-dense agentic UIs
 * are bespoke, and this is the part you are expected to replace. It exists so
 * an app can be running in ten lines.
 *
 * Everything uses textContent. Tool payloads are untrusted input.
 */

export const h = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

export function renderTranscript(root, chat) {
  const { state } = chat;
  const atBottom = root.scrollHeight - root.scrollTop - root.clientHeight < 160;

  root.replaceChildren();
  for (const block of state.blocks) root.append(renderBlock(block, chat));

  if (atBottom) root.scrollTop = root.scrollHeight;
}

function renderBlock(block, chat) {
  switch (block.kind) {
    case "user": {
      const el = h("div", "hai-block hai-user");
      el.append(h("div", "hai-body", block.text));
      return el;
    }

    case "assistant": {
      const el = h("div", "hai-block hai-assistant");
      el.append(h("div", "hai-body", block.text ?? ""));
      return el;
    }

    case "interaction": {
      const el = h("div", "hai-block hai-interaction");
      el.append(h("span", "hai-arrow", "↳"), h("span", null, block.label));
      return el;
    }

    case "error":
      return h("div", "hai-block hai-error", `error: ${block.message}`);

    // Provenance chrome. The tool row and its surface are one visual unit:
    // what produced this, with what arguments, and what the model got back.
    case "tool": {
      const el = h("details", `hai-block hai-tool hai-status-${block.status}`);
      const summary = h("summary");
      summary.append(
        h("span", "hai-gear", "⚙"),
        h("span", "hai-tname", block.name),
        h("span", "hai-targs", JSON.stringify(block.input)),
        h(
          "span",
          "hai-tstatus",
          block.status === "running" ? "…" : block.status === "awaiting" ? "awaiting user" : `${block.ms}ms`,
        ),
      );
      el.append(summary);
      const detail = h("div", "hai-tool-detail");
      detail.append(h("div", "hai-label", "→ tool_result — all the model receives"));
      detail.append(h("pre", "hai-digest", block.result ?? "…"));
      el.append(detail);
      return el;
    }

    case "ui": {
      const el = h("div", "hai-surface");
      el.dataset.handle = block.handle;
      const surface = chat.state.surfaces.get(block.handle);
      if (surface?.props) {
        queueMicrotask(() => chat.mount(block.handle, el));
      } else {
        el.append(h("div", "hai-skeleton", `${surface?.component ?? "surface"} · loading…`));
      }
      return el;
    }

    default:
      return h("div", "hai-block", JSON.stringify(block));
  }
}
