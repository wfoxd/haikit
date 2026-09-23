/**
 * hai-client — the default UI.
 *
 * `mountChat()` builds the shell, wires the composer, renders the transcript and
 * (optionally) the context inspector. It is the ten-line path to a running app.
 *
 *   import { mountChat } from "/hai-client/app.js";
 *   import { registry } from "./components.js";
 *   mountChat({ root: document.querySelector("#app"), registry });
 *
 * It is a convenience, not the API. Everything it does is built on the headless
 * pieces — `createChat` and `renderTranscript` — and when this shell stops
 * fitting, drop to those and write your own. That is the expected path, not a
 * failure mode.
 */

import { createChat } from "./index.js";
import { renderTranscript, h } from "./transcript.js";

/**
 * @param {{
 *   root: HTMLElement,
 *   registry: Record<string, { mount: Function }>,
 *   endpoint?: string,
 *   title?: string,
 *   subtitle?: string,
 *   suggestions?: string[],
 *   inspector?: boolean,
 *   placeholder?: string,
 *   emptyText?: string,
 * }} options
 */
export function mountChat({
  root,
  registry,
  endpoint = "/hai",
  title = "hai",
  subtitle = "",
  suggestions = [],
  inspector = true,
  placeholder = "message…",
  emptyText = "",
}) {
  const chat = createChat({ endpoint, registry });

  // ── shell ──────────────────────────────────────────────────────────
  const shell = h("div", "hai-shell");

  const top = h("header", "hai-top");
  const modelEl = h("span", "hai-model", "…");
  top.append(h("span", "hai-title", title), h("span", "hai-subtitle", subtitle), modelEl);

  const transcript = h("div", "hai-transcript");
  const statusEl = h("div", "hai-status");
  const input = h("textarea", "hai-input");
  input.rows = 1;
  input.placeholder = placeholder;
  const sendBtn = h("button", "hai-send", "Send");

  const composer = h("div", "hai-composer");
  composer.append(input, sendBtn);

  const chatPane = h("section", "hai-chat");
  chatPane.append(transcript, statusEl, composer);

  const main = h("div", `hai-main${inspector ? " has-inspector" : ""}`);
  main.append(chatPane);

  let inspectorBody = null;
  if (inspector) {
    const aside = h("aside", "hai-inspector");
    const heading = h("div", "hai-inspector-title", "Model context ");
    heading.append(h("span", null, "— everything the model sees"));
    inspectorBody = h("div", "hai-inspector-body");
    aside.append(heading, inspectorBody);
    main.append(aside);
  }

  shell.append(top, main);
  root.replaceChildren(shell);

  // ── empty state ────────────────────────────────────────────────────
  const send = () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    chat.send(text);
  };

  function renderEmpty() {
    const empty = h("div", "hai-empty");
    if (emptyText) empty.append(h("p", null, emptyText));
    if (suggestions.length) {
      const row = h("div", "hai-suggestions");
      for (const s of suggestions) {
        const b = h("button", "hai-suggestion", s);
        b.onclick = () => { input.value = s; send(); };
        row.append(b);
      }
      empty.append(row);
    }
    transcript.replaceChildren(empty);
  }

  // ── wiring ─────────────────────────────────────────────────────────
  chat.subscribe((state) => {
    if (state.blocks.length === 0) renderEmpty();
    else renderTranscript(transcript, chat);

    modelEl.textContent = state.model;
    sendBtn.disabled = state.status === "streaming";
    statusEl.dataset.status = state.status;
    statusEl.textContent =
      state.status === "streaming" ? "thinking…"
      : state.status === "awaiting" ? "awaiting your selection in the component above"
      : "";
    input.placeholder =
      state.status === "awaiting" ? "pick an option above — or type to override" : placeholder;

    if (inspectorBody) renderInspector(inspectorBody, state.context);
  });

  sendBtn.onclick = send;
  input.onkeydown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  renderEmpty();
  return chat;
}

/**
 * The context inspector. Makes the dual channel visible, which is the whole
 * argument — keep it on while developing.
 */
export function renderInspector(el, { messages = [], modelTokens = 0, uiTokens = 0 } = {}) {
  el.replaceChildren();

  const pct = uiTokens ? Math.round((1 - modelTokens / (modelTokens + uiTokens)) * 100) : 0;
  const bar = h("div", "hai-ctx-bar");
  bar.append(
    h("div", null, `model context  ~${modelTokens} tok`),
    h("div", "hai-stat-dim", `browser payload  ~${uiTokens} tok`),
    h("div", "hai-stat-good", uiTokens ? `${pct}% kept out of context` : ""),
  );
  el.append(bar);

  for (const m of messages) {
    const box = h("div", "hai-msg");
    box.append(h("div", "hai-role", m.role));
    const body = h("div", "hai-mbody");
    if (typeof m.content === "string") {
      body.append(h("div", null, m.content));
    } else {
      for (const b of m.content ?? []) {
        if (b.type === "text" && b.text) body.append(h("div", null, b.text));
        if (b.type === "tool_use")
          body.append(h("div", "hai-tu", `tool_use ${b.name} ${JSON.stringify(b.input)}`));
        if (b.type === "tool_result") body.append(h("div", "hai-tr", b.content));
      }
    }
    box.append(body);
    el.append(box);
  }
}
