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
import { renderTranscript, closeTranscript, h } from "./transcript.js";
import { icon } from "./icons.js";

/** Below this width the inspector opens over the chat rather than beside it. */
const WIDE = "(min-width: 900px)";

/** Numbers the inspector's ids, so two shells on a page never share one. */
let shells = 0;

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
 *   theme?: "light" | "dark",
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
  theme,
}) {
  const chat = createChat({ endpoint, registry });
  const id = `hai-${++shells}`;

  // Unset, the page follows the system. A pin goes on the root, where hai.css
  // sets the tokens: a minifier that lowers light-dark() resolves them there,
  // so a pin on the shell alone would not reach them.
  const page = document.documentElement;
  const pinned = theme === "light" || theme === "dark";
  if (pinned) page.dataset.haiTheme = theme;

  // ── shell ──────────────────────────────────────────────────────────
  const shell = h("div", "hai-shell");

  const top = h("header", "hai-top");
  const brand = h("div", "hai-brand");
  brand.append(icon("brand", "hai-icon hai-mark"), h("span", "hai-title", title));
  if (subtitle) brand.append(h("span", "hai-subtitle", subtitle));

  const modelEl = h("span", "hai-model");
  modelEl.hidden = true;
  const newBtn = button("hai-btn", "plus", "New chat");
  newBtn.onclick = () => chat.reset();
  const actions = h("div", "hai-actions");
  actions.append(modelEl, newBtn);
  top.append(brand, actions);

  const transcript = h("div", "hai-transcript");
  const statusEl = h("div", "hai-status");
  statusEl.setAttribute("role", "status");
  const input = h("textarea", "hai-input");
  input.rows = 1;
  input.placeholder = placeholder;
  input.setAttribute("aria-label", "Message");
  const sendBtn = h("button", "hai-send");
  sendBtn.type = "button";
  sendBtn.setAttribute("aria-label", "Send");
  sendBtn.append(icon("send"));

  const box = h("div", "hai-composer-box");
  box.append(input, sendBtn);
  const composer = h("div", "hai-composer");
  composer.append(box);

  const chatPane = h("section", "hai-chat");
  chatPane.append(transcript, statusEl, composer);

  const main = h("div", `hai-main${inspector ? " has-inspector" : ""}`);
  main.append(chatPane);

  let inspectorBody = null;
  let ctxCount = null;
  if (inspector) {
    const aside = h("aside", "hai-inspector");
    aside.id = `${id}-inspector`;
    aside.setAttribute("aria-label", "Model context");
    const head = h("div", "hai-inspector-head");
    const heading = h("div", "hai-inspector-title", "Model context");
    heading.append(h("span", null, "everything the model sees"));
    const hide = h("button", "hai-icon-btn");
    hide.type = "button";
    hide.setAttribute("aria-label", "Hide model context");
    hide.append(icon("close"));
    head.append(heading, hide);
    inspectorBody = h("div", "hai-inspector-body");
    aside.append(head, inspectorBody);
    main.append(aside);

    // Beside the chat on a wide screen, over it on a narrow one: either way
    // the header button says how much the model holds, open or not.
    const toggle = button("hai-btn hai-ctx-toggle", "panel", "Context");
    ctxCount = h("span", "hai-ctx-count");
    toggle.append(ctxCount);
    toggle.setAttribute("aria-controls", aside.id);
    actions.append(toggle);

    const wide = () => typeof matchMedia !== "function" || matchMedia(WIDE).matches;
    const show = (open) => {
      main.classList.toggle("inspector-open", open);
      toggle.setAttribute("aria-expanded", String(open));
    };
    toggle.onclick = () => {
      const open = !main.classList.contains("inspector-open");
      show(open);
      // over the chat, it is where the reader is now
      if (open && !wide()) hide.focus();
    };
    hide.onclick = () => {
      show(false);
      toggle.focus();
    };
    aside.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !wide()) hide.onclick();
    });
    show(wide());
  }

  shell.append(top, main);
  root.replaceChildren(shell);

  // ── composer ───────────────────────────────────────────────────────
  // The input grows with what is typed, up to the height hai.css allows.
  const fit = () => {
    input.style.height = "auto";
    input.style.height = `${input.scrollHeight}px`;
  };
  input.addEventListener("input", fit);

  const send = () => {
    const text = input.value.trim();
    if (!text) return;
    const sending = chat.send(text);
    // send() refuses an out-of-date conversation before its first await, so
    // this already knows: keep the text for the new conversation instead
    if (chat.state.expired) return;
    input.value = "";
    fit();
    // A message queued behind a long turn can still be turned away later, if
    // the conversation goes out of date before its turn comes. Give the text
    // back then, unless something new has been typed since.
    sending.then((sent) => {
      if (!sent && !input.value) {
        input.value = text;
        fit();
      }
    });
  };

  // ── empty state ────────────────────────────────────────────────────
  function emptyState() {
    const empty = h("div", "hai-empty");
    if (!emptyText && !suggestions.length) return empty;
    empty.append(icon("brand", "hai-icon hai-empty-mark"));
    if (emptyText) empty.append(h("p", null, emptyText));
    if (suggestions.length) {
      const row = h("div", "hai-suggestions");
      for (const s of suggestions) {
        const b = h("button", "hai-suggestion", s);
        b.type = "button";
        b.onclick = () => { input.value = s; send(); };
        row.append(b);
      }
      empty.append(row);
    }
    return empty;
  }

  // Every render goes through the transcript, an empty one included, so the
  // elements a reset leaves behind are taken out and stop being observed.
  // The suggestions follow it until the user engages — a first message, or an
  // answer to something init showed. What the conversation opened with (an
  // init tool's row, a welcome surface) doesn't replace them.
  const engaged = () => chat.state.blocks.some((b) => b.kind === "user" || b.kind === "interaction");
  const render = () => {
    renderTranscript(transcript, chat);
    if (!engaged()) transcript.append(emptyState());
  };

  // ── status ─────────────────────────────────────────────────────────
  // A live region: it changes only when the status does, so a screen reader
  // hears "Thinking" once a turn, not once per streamed word.
  let shownStatus = null;
  function showStatus(status) {
    if (status === shownStatus) return;
    shownStatus = status;
    statusEl.dataset.status = status;
    statusEl.replaceChildren();
    if (status === "streaming") {
      const dots = h("span", "hai-dots");
      dots.setAttribute("aria-hidden", "true");
      dots.append(h("i"), h("i"), h("i"));
      statusEl.append(dots, "Thinking");
    } else if (status === "awaiting") {
      statusEl.append(h("span", "hai-pulse"), "Waiting on your selection above");
    }
  }

  // ── wiring ─────────────────────────────────────────────────────────
  chat.subscribe((state, event) => {
    // chat.close(): the surfaces are unmounted and the chat lets go of this
    // listener; the shell goes too, and nothing of it stays observed.
    if (event.type === "closed") {
      closeTranscript(transcript);
      shell.remove();
      if (pinned && page.dataset.haiTheme === theme) delete page.dataset.haiTheme;
      return;
    }

    // A new conversation starts at once, so the server's init tool — if it
    // has one — runs before anything is typed.
    if (event.type === "reset") chat.start();

    render();

    modelEl.textContent = state.model;
    modelEl.hidden = !state.model;
    newBtn.disabled = !engaged() && !state.expired;
    input.disabled = state.expired !== null;
    sendBtn.disabled = state.status === "streaming" || state.expired !== null;
    showStatus(state.expired ? "idle" : state.status);
    input.placeholder =
      state.expired ? "start a new conversation to continue"
      : state.status === "awaiting" ? "pick an option above — or type to override"
      : placeholder;

    if (inspectorBody) {
      renderInspector(inspectorBody, state.context);
      const tokens = state.context.modelTokens;
      ctxCount.textContent = tokens ? `~${tokens.toLocaleString()} tok` : "";
    }
  });

  sendBtn.onclick = send;
  input.onkeydown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  };

  newBtn.disabled = true;
  render();
  chat.start();
  return chat;
}

/** A header button: an icon, and a label that narrow screens keep for screen
 *  readers only. */
function button(className, iconName, label) {
  const b = h("button", className);
  b.type = "button";
  b.append(icon(iconName), h("span", "hai-btn-label", label));
  return b;
}

/**
 * The context inspector. Makes the dual channel visible, which is the whole
 * argument — keep it on while developing.
 */
export function renderInspector(el, { messages = [], modelTokens = 0, uiTokens = 0 } = {}) {
  // following the newest context, as the transcript does, unless scrolled up
  const following = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  el.replaceChildren();

  if (!messages.length && !modelTokens && !uiTokens) {
    el.append(
      h("p", "hai-inspector-empty", "Nothing yet. Every message, tool call and digest the model receives shows up here."),
    );
    return;
  }

  const total = modelTokens + uiTokens;
  const pct = uiTokens ? Math.round((1 - modelTokens / total) * 100) : 0;
  const stats = h("div", "hai-ctx");
  if (uiTokens) {
    const headline = h("div", "hai-ctx-headline");
    headline.append(h("span", "hai-ctx-pct", `${pct}%`), h("span", null, "kept out of context"));
    stats.append(headline);
  }
  const meter = h("div", "hai-meter");
  meter.setAttribute("aria-hidden", "true");
  const share = h("span", "hai-meter-model");
  share.style.width = `${total ? (modelTokens / total) * 100 : 100}%`;
  meter.append(share);
  stats.append(
    meter,
    stat("hai-key-model", "model context", modelTokens),
    stat("hai-key-ui", "browser payload", uiTokens),
  );
  el.append(stats);

  for (const m of messages) {
    const box = h("div", `hai-msg hai-msg-${m.role}`);
    box.append(h("div", "hai-role", m.role));
    const body = h("div", "hai-mbody");
    if (typeof m.content === "string") {
      body.append(h("div", null, m.content));
    } else {
      for (const b of m.content ?? []) {
        if (b.type === "text" && b.text) body.append(h("div", null, b.text));
        if (b.type === "tool_use") {
          const call = h("div", "hai-tu");
          call.append(h("span", "hai-kind", `tool_use · ${b.name}`), h("div", null, JSON.stringify(b.input)));
          body.append(call);
        }
        if (b.type === "tool_result") {
          const result = h("div", "hai-tr");
          result.append(h("span", "hai-kind", "tool_result"), h("div", null, plain(b.content)));
          body.append(result);
        }
      }
    }
    box.append(body);
    el.append(box);
  }

  if (following) el.scrollTop = el.scrollHeight;
}

function stat(key, label, tokens) {
  const row = h("div", "hai-ctx-stat");
  const name = h("span", "hai-ctx-label");
  name.append(h("i", `hai-key ${key}`), label);
  row.append(name, h("span", "hai-ctx-tok", `~${tokens.toLocaleString()} tok`));
  return row;
}

/** A tool_result's content as text: a string, or an array of content blocks. */
function plain(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => c?.text ?? JSON.stringify(c)).join("\n");
  return JSON.stringify(content);
}
