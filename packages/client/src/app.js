/**
 * hai-client — the default UI.
 *
 * `mountChat()` builds the shell, wires the composer, renders the transcript and
 * (optionally) the model context debug drawer. It is the ten-line path to a
 * running app.
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
import { icon, mark, FAVICON } from "./icons.js";
import * as cls from "./classes.js";

/** Below this width the drawer opens over the chat rather than beside it. */
const WIDE = "(min-width: 900px)";

/** The drawer's name, as its heading shows it and assistive technology says it. */
const DRAWER = "Model context debug drawer";

/** Where the drawer remembers being open, so a reload while developing keeps it. */
const REMEMBER = "hai:debug-drawer";

/** Numbers the inspector's ids, so two shells on a page never share one. */
let shells = 0;

/**
 * The page's scheme pin is one attribute shared by every chat on it. It
 * follows the newest themed chat still open; when the last one closes, the
 * page gets back the pin it had before the first. A pin the page set itself
 * in the meantime is the page's, and closing a chat leaves it alone.
 */
const pinning = { chats: [], pageOwn: undefined, ours: undefined };

function pin(chat) {
  if (!pinning.chats.length) pinning.pageOwn = document.documentElement.dataset.haiTheme;
  pinning.chats.push(chat);
  setPin(chat.theme);
}

function unpin(chat) {
  const i = pinning.chats.indexOf(chat);
  if (i < 0) return;
  pinning.chats.splice(i, 1);
  if (document.documentElement.dataset.haiTheme !== pinning.ours) return;
  setPin(pinning.chats.at(-1)?.theme ?? pinning.pageOwn);
}

function setPin(theme) {
  const page = document.documentElement;
  if (theme === undefined) delete page.dataset.haiTheme;
  else page.dataset.haiTheme = theme;
  pinning.ours = theme;
}

/**
 * A page without an icon of its own gets the haikit favicon while a chat is
 * open on it. Every chat shares the one link; the last to close takes it away.
 */
const favicon = { chats: 0, link: null };

function addFavicon() {
  if (favicon.chats++ || document.querySelector('link[rel~="icon"]')) return;
  const link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/svg+xml";
  link.href = FAVICON;
  document.head.append(link);
  favicon.link = link;
}

function dropFavicon() {
  if (--favicon.chats) return;
  favicon.link?.remove();
  favicon.link = null;
}

/**
 * @param {{
 *   root: HTMLElement,
 *   registry: Record<string, { mount: Function }>,
 *   notices?: Record<string, { mount: Function }>,
 *   endpoint?: string,
 *   title?: string,
 *   subtitle?: string,
 *   suggestions?: string[],
 *   inspector?: boolean,
 *   placeholder?: string,
 *   emptyText?: string,
 *   theme?: "light" | "dark",
 *   dock?: boolean,
 *   eventsFallbackMs?: number,
 *   pollHoldMs?: number,
 *   fetch?: (input: string, init: RequestInit) => Promise<Response>,
 *   signIn?: { href: string, label?: string },
 * }} options
 */
export function mountChat({
  root,
  registry,
  notices,
  signals,
  endpoint = "/hai",
  title = "HaiKIT",
  subtitle = "",
  suggestions = [],
  inspector = true,
  placeholder = "message…",
  emptyText = "",
  theme,
  dock = true,
  eventsFallbackMs,
  pollHoldMs,
  fetch,
  signIn,
}) {
  // undefined leaves createChat's defaults
  const chat = createChat({ endpoint, registry, notices, signals, eventsFallbackMs, pollHoldMs, fetch });
  const id = `hai-${++shells}`;

  // Unset, the page follows the system. A pin goes on the root, where hai.css
  // sets the tokens: a minifier that lowers light-dark() resolves them there,
  // so a pin on the shell alone would not reach them.
  const pinned = theme === "light" || theme === "dark" ? { theme } : null;
  if (pinned) pin(pinned);
  addFavicon();

  // ── shell ──────────────────────────────────────────────────────────
  const shell = h("div", cls.shell);

  const top = h("header", cls.top);
  const brand = h("div", cls.brand);
  brand.append(mark("small", cls.markSmall), h("span", cls.title, title));
  if (subtitle) brand.append(h("span", cls.subtitle, subtitle));

  const modelEl = h("span", cls.model);
  modelEl.hidden = true;
  const newBtn = button(cls.btn, "plus", "New chat");
  newBtn.onclick = () => chat.reset();
  const actions = h("div", cls.actions);
  actions.append(modelEl, newBtn);
  top.append(brand, actions);

  const transcript = h("div", cls.transcript);
  const statusEl = h("div", cls.status);
  statusEl.setAttribute("role", "status");
  const input = h("textarea", cls.input);
  input.rows = 1;
  input.placeholder = placeholder;
  input.setAttribute("aria-label", "Message");
  const sendBtn = h("button", cls.send);
  sendBtn.type = "button";
  sendBtn.setAttribute("aria-label", "Send");
  sendBtn.append(icon("send", cls.sendIcon));

  const box = h("div", cls.composerBox);
  box.append(input, sendBtn);
  const composer = h("div", cls.composer);
  composer.append(box);

  const chatPane = h("section", cls.chat);
  chatPane.append(transcript, statusEl, composer);

  const main = h("div", inspector ? `${cls.main} has-inspector` : cls.main);
  main.append(chatPane);

  const wideQuery = typeof matchMedia === "function" ? matchMedia(WIDE) : null;
  const wide = () => !wideQuery || wideQuery.matches;

  // Before the drawer, so the dock hears Escape first: it closes what the
  // reader is in, and the drawer what's left.
  const docked = dock
    ? createDock({ chat, id, shell, chatPane, transcript, composer, statusEl, wide, wideQuery,
        drawerOpen: () => main.classList.contains("inspector-open"),
        onChange: () => showWaiting() })
    : null;

  let inspectorBody = null;
  let ctxCount = null;
  let releaseDrawer = () => {};
  if (inspector) {
    // The model context debug drawer: closed until asked for, it slides in
    // from the right, beside the chat on a wide screen and over it on a
    // narrow one. The header button that opens it says how much the model
    // holds, open or not.
    const aside = h("aside", cls.inspector);
    aside.id = `${id}-inspector`;
    aside.setAttribute("aria-label", DRAWER);
    const head = h("div", cls.inspectorHead);
    const heading = h("div", cls.inspectorTitle, DRAWER);
    heading.append(h("span", cls.inspectorSub, "everything the model sees"));
    const hide = h("button", cls.iconBtn);
    hide.type = "button";
    hide.setAttribute("aria-label", `Close ${DRAWER.toLowerCase()}`);
    hide.append(icon("close"));
    head.append(heading, hide);
    inspectorBody = h("div", cls.inspectorBody);
    aside.append(head, inspectorBody);
    main.append(aside);

    const toggle = button(cls.ctxToggle, "panel", "Context");
    ctxCount = h("span", cls.ctxCount);
    toggle.append(ctxCount);
    toggle.title = DRAWER;
    toggle.setAttribute("aria-controls", aside.id);
    actions.append(toggle);

    const isOpen = () => main.classList.contains("inspector-open");
    // Over the chat, on a narrow screen, the drawer is all there is to reach:
    // the chat behind it is inert until it closes or the screen widens.
    const sync = () => {
      chatPane.inert = isOpen() && !wide();
    };
    const set = (open) => {
      main.classList.toggle("inspector-open", open);
      toggle.setAttribute("aria-expanded", String(open));
      // out of reach as soon as it starts to close, not once it has slid away
      aside.inert = !open;
      sync();
    };
    const show = (open) => {
      set(open);
      try {
        localStorage.setItem(REMEMBER, open ? "open" : "closed");
      } catch {}
    };
    toggle.onclick = () => {
      const open = !isOpen();
      show(open);
      if (open) hide.focus();
    };
    hide.onclick = () => {
      show(false);
      toggle.focus();
    };
    // a tap on the chat it covers closes it, as a tap outside a dialog does,
    // and focus goes back to Context, as it does from the close button
    main.addEventListener("click", (e) => {
      if (e.target === main && chatPane.inert) hide.onclick();
    });
    // Escape closes it from anywhere in the shell, unless something there
    // used the key first, such as a surface closing a menu of its own. Focus
    // goes back to Context from inside the drawer; a reader typing in the
    // composer keeps their place.
    shell.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || e.defaultPrevented || !isOpen()) return;
      const inside = aside.contains(document.activeElement);
      show(false);
      if (inside) toggle.focus();
    });
    wideQuery?.addEventListener("change", sync);
    releaseDrawer = () => wideQuery?.removeEventListener("change", sync);

    // Open again after a reload if it was open before, but only beside the
    // chat: over it, on a narrow screen, it would hide the page it debugs.
    let remembered = null;
    try {
      remembered = localStorage.getItem(REMEMBER);
    } catch {}
    set(remembered === "open" && wide());
  }

  shell.append(top, main);
  root.replaceChildren(shell);

  // A start that fails, such as the network being down, is reported, not
  // left unhandled: the first message starts the conversation anyway.
  const start = () => chat.start().catch((err) => console.error("[haikit] the conversation couldn't start:", err));

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
    const giveBack = () => {
      if (!input.value) {
        input.value = text;
        fit();
      }
    };
    sending.then(
      (sent) => sent || giveBack(),
      // the request itself failed, such as the network being down: the text
      // goes back, and the error is reported rather than left unhandled
      (err) => {
        console.error("[haikit] the message wasn't sent:", err);
        giveBack();
      },
    );
  };

  // ── empty state ────────────────────────────────────────────────────
  function emptyState() {
    const empty = h("div", cls.empty);
    if (!emptyText && !suggestions.length) return empty;
    empty.append(mark("full", cls.emptyMark));
    if (emptyText) empty.append(h("p", cls.emptyText, emptyText));
    if (suggestions.length) {
      const row = h("div", cls.suggestions);
      for (const s of suggestions) {
        const b = h("button", cls.suggestion, s);
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
    renderTranscript(transcript, chat, docked ? { onDock: docked.onDock } : {});
    if (!engaged()) transcript.append(emptyState());
    docked?.sync();
  };

  // ── status ─────────────────────────────────────────────────────────
  // A live region: it changes only when the status does, or where the
  // question it waits on is, so a screen reader hears "Thinking" once a turn,
  // not once per streamed word.
  let shownStatus = null;
  function showStatus(status) {
    const where = status === "awaiting" && docked?.waiting() ? "in the dock" : "above";
    const why = status === "unauthorized" ? chat.state.unauthorized?.message ?? "" : "";
    if (`${status} ${where} ${why}` === shownStatus) return;
    shownStatus = `${status} ${where} ${why}`;
    statusEl.dataset.status = status;
    statusEl.replaceChildren();
    if (status === "unauthorized") {
      // why the server turned the chat away, and where to sign in, if the page said
      statusEl.append(why);
      if (signIn?.href) {
        const link = h("a", cls.signIn, signIn.label ?? "Sign in");
        link.href = signIn.href;
        statusEl.append(link);
      }
    } else if (status === "streaming") {
      const dots = h("span", cls.dots);
      dots.setAttribute("aria-hidden", "true");
      dots.append(h("i", cls.dot), h("i", cls.dot), h("i", cls.dot));
      statusEl.append(dots, "Thinking");
    } else if (status === "awaiting") {
      statusEl.append(h("span", cls.pulse), `Waiting on your selection ${where}`);
    }
  }

  // The status line and the message box say where the question waiting on the
  // reader is: above, or in the dock.
  function showWaiting() {
    const { state } = chat;
    showStatus(
      state.unauthorized && state.status !== "streaming" ? "unauthorized" : state.expired ? "idle" : state.status,
    );
    input.placeholder =
      state.expired ? "start a new conversation to continue"
      : state.status === "awaiting" ? `pick an option ${docked?.waiting() ? "in the dock" : "above"} — or type to override`
      : placeholder;
  }

  // ── wiring ─────────────────────────────────────────────────────────
  chat.subscribe((state, event) => {
    // chat.close(): the surfaces are unmounted and the chat lets go of this
    // listener; the shell goes too, and nothing of it stays observed.
    if (event.type === "closed") {
      docked?.release();
      closeTranscript(transcript);
      shell.remove();
      releaseDrawer();
      if (pinned) unpin(pinned);
      dropFavicon();
      return;
    }

    // A new conversation starts at once, so the server's init tool — if it
    // has one — runs before anything is typed. The last one's surfaces are
    // gone, docked ones too.
    if (event.type === "reset") {
      docked?.clear();
      start();
    }

    render();

    modelEl.textContent = state.model;
    modelEl.hidden = !state.model;
    // There is something to start over from once the user has engaged, or
    // once the server has a conversation: init may already be asking.
    newBtn.disabled = !engaged() && !state.expired && !state.conversationId;
    input.disabled = state.expired !== null;
    sendBtn.disabled = state.status === "streaming" || state.expired !== null;
    showWaiting();

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
  // a server without an init tool sends nothing until the first message
  if (inspectorBody) renderInspector(inspectorBody, chat.state.context);
  start();
  return chat;
}

/**
 * The dock: a shelf on top of the composer that a surface goes to when its
 * Dock button is pressed, and a window above it where one docked surface at a
 * time opens. Docking moves the surface's element, never mounts it again, so
 * its component keeps its state; an iframe or video inside starts over, as
 * it would anywhere a page moves one. The surface's card stays in the
 * transcript, where Put back returns it.
 *
 * When the shelf's row is full, the oldest go into a pile at its end, which
 * lists them. A surface waiting on the reader, or open, stays in the row.
 * Remove all, at the shelf's end, puts every docked surface back at once.
 */
function createDock({ chat, id, shell, chatPane, transcript, composer, statusEl, wide, wideQuery, drawerOpen, onChange }) {
  /** Docked surfaces, oldest first. */
  const entries = [];
  /** The one open in the window. */
  let open = null;

  // ── the shelf ────────────────────────────────────────────────────────
  const shelf = h("div", cls.dock);
  shelf.hidden = true;
  shelf.setAttribute("role", "toolbar");
  shelf.setAttribute("aria-label", "Docked surfaces");
  const count = h("span", cls.dockCount);
  count.setAttribute("aria-hidden", "true");
  const row = h("div", cls.dockRow);
  const pile = h("span", cls.dockPile);
  pile.hidden = true;
  const pileBtn = h("button", cls.dockItem);
  pileBtn.type = "button";
  pileBtn.setAttribute("aria-expanded", "false");
  pileBtn.setAttribute("aria-controls", `${id}-pile`);
  const pileText = h("span");
  const pileMark = changedMark();
  pileBtn.append(icon("stack", cls.dockItemIcon), pileText, pileMark);
  const list = h("div", cls.pileList);
  list.id = `${id}-pile`;
  list.hidden = true;
  pile.append(pileBtn, list);
  // Remove all, at the shelf's end: every docked surface back in the chat
  const clear = h("button", cls.dockClear);
  clear.type = "button";
  clear.title = "Remove all from dock";
  clear.setAttribute("aria-label", "Remove all from the dock");
  clear.append(icon("undockAll", cls.dockClearIcon));
  shelf.append(count, row, pile, clear);
  composer.prepend(shelf);

  // ── the window ───────────────────────────────────────────────────────
  const win = h("section", cls.win);
  win.id = `${id}-window`;
  win.hidden = true;
  win.tabIndex = -1;
  win.setAttribute("role", "dialog");
  win.setAttribute("aria-labelledby", `${id}-window-name`);
  const winName = h("span", cls.winName);
  winName.id = `${id}-window-name`;
  const winTool = h("span", cls.winTool);
  const winBadge = h("span", cls.winBadge);
  const remove = h("button", cls.barIcon);
  remove.type = "button";
  remove.title = "Remove from dock";
  remove.append(icon("undock", cls.barIconIcon));
  const minimise = h("button", cls.barIcon);
  minimise.type = "button";
  minimise.title = "Dock";
  minimise.append(icon("dock", cls.barIconIcon));
  const winBar = h("div", cls.winBar);
  winBar.append(icon("window", cls.winIcon), winName, winTool, winBadge, remove, minimise);
  const winBody = h("div", cls.winBody);
  win.append(winBar, winBody);

  // what docking did, for a screen reader: the button pressed has gone
  const live = h("div", cls.dockLive);
  live.setAttribute("role", "status");
  chatPane.append(win, live);

  // ── each surface, as it is now ───────────────────────────────────────
  const surfaceOf = (entry) => chat.state.surfaces.get(entry.block.handle);
  const nameOf = (entry) => surfaceOf(entry)?.component ?? "surface";
  const toolOf = (entry) => chat.state.blocks.find((b) => b.kind === "tool" && b.id === entry.block.toolId)?.name;
  // a question still open waits on the reader, as its tool row says
  const statusOf = (entry) => {
    if (chat.state.expired) return "expired";
    const surface = surfaceOf(entry);
    return surface?.mode === "elicit" && surface.state !== "frozen" ? "awaiting" : "live";
  };

  function onDock({ handle, card, element }) {
    if (entries.some((e) => e.card === card)) return;
    const block = chat.state.blocks.find((b) => b.kind === "ui" && b.handle === handle);
    if (!block) return;
    const entry = { block, card, element, bar: card.firstElementChild, props: surfaceOf({ block })?.props, changed: false, stacked: false };

    // what stays in the transcript, in the surface's place
    entry.stubText = h("span", cls.dockedText);
    entry.back = h("button", cls.barIcon);
    entry.back.type = "button";
    entry.back.title = "Put back";
    entry.back.append(icon("undock", cls.barIconIcon));
    entry.back.onclick = () => undock(entry, true);
    const stub = h("div", cls.docked);
    stub.append(entry.stubText, entry.back);

    // and its button on the shelf
    entry.item = h("button", cls.dockItem);
    entry.item.type = "button";
    entry.item.setAttribute("aria-controls", win.id);
    entry.itemName = h("span");
    entry.dot = h("span", cls.dockDot);
    entry.dot.setAttribute("aria-hidden", "true");
    entry.mark = changedMark();
    entry.item.append(icon("window", cls.dockItemIcon), entry.itemName, entry.dot, entry.mark);
    entry.item.onclick = () => (open === entry ? close(true) : show(entry));
    row.append(entry.item);

    element.hidden = true;
    winBody.append(element);
    card.replaceChildren(stub);
    card.dataset.docked = "";
    entries.push(entry);
    sync();
    // the reader stays where they were, on the button that undoes it
    entry.back.focus();
    live.textContent = `${nameOf(entry)} docked`;
  }

  function undock(entry, focus) {
    if (open === entry) close(false);
    entries.splice(entries.indexOf(entry), 1);
    entry.item.remove();
    entry.element.hidden = false;
    entry.card.replaceChildren(entry.bar, entry.element);
    delete entry.card.dataset.docked;
    sync();
    if (focus) {
      entry.bar.querySelector("button")?.focus();
      entry.card.scrollIntoView?.({ block: "nearest" });
    }
    live.textContent = `${nameOf(entry)} is back in the chat`;
  }

  function show(entry) {
    if (open && open !== entry) open.element.hidden = true;
    // one opened from the pile comes into the row, as the newest
    if (entry.stacked) {
      entries.push(...entries.splice(entries.indexOf(entry), 1));
      row.append(entry.item);
    }
    open = entry;
    entry.changed = false;
    entry.element.hidden = false;
    measure();
    win.hidden = false;
    closePile(false);
    sync();
    win.focus();
  }

  function close(focus) {
    if (!open) return;
    const entry = open;
    open = null;
    entry.element.hidden = true;
    win.hidden = true;
    sync();
    if (focus) (entry.stacked ? pileBtn : entry.item).focus();
  }

  remove.onclick = () => open && undock(open, true);
  minimise.onclick = () => close(true);

  // Every docked surface back in its card, oldest first. The shelf goes with
  // them, so the reader goes to the message box under it, or, once the
  // conversation has expired and the box is disabled, to the button that
  // starts a new one.
  clear.onclick = () => {
    const n = entries.length;
    for (const entry of [...entries]) undock(entry, false);
    const input = composer.querySelector(".hai-input");
    if (input && !input.disabled) input.focus();
    else transcript.querySelector(".hai-expired .hai-new")?.focus();
    live.textContent = n === 1 ? "1 surface is back in the chat" : `${n} surfaces are back in the chat`;
  };

  // ── keeping up ───────────────────────────────────────────────────────
  // After every event the chat renders, and after every change here.
  function sync() {
    for (const entry of entries) {
      // new props while docked and closed: the reader hasn't seen them
      const props = surfaceOf(entry)?.props;
      if (props !== entry.props) {
        entry.changed ||= entry !== open;
        entry.props = props;
      }
      const name = nameOf(entry);
      const status = statusOf(entry);
      const isOpen = open === entry;
      setText(entry.itemName, name);
      setAttr(entry.item, "data-status", status);
      setAttr(entry.item, "aria-expanded", String(isOpen));
      setAttr(
        entry.item,
        "aria-label",
        [name, status === "awaiting" && "awaiting you", status === "expired" && "out of date", entry.changed && "changed"]
          .filter(Boolean)
          .join(", "),
      );
      setHidden(entry.dot, status !== "awaiting");
      setHidden(entry.mark, !entry.changed);
      const text = `${name} ${isOpen ? "is open in a window" : "is in the dock"}`;
      if (entry.stubText.textContent !== text) entry.stubText.replaceChildren(icon("dock", cls.dockedIcon), text);
      setAttr(entry.back, "aria-label", `Put ${name} back`);
    }
    setHidden(shelf, entries.length === 0);
    setText(count, `docked · ${entries.length}`);

    if (open) {
      const name = nameOf(open);
      const tool = toolOf(open);
      const status = statusOf(open);
      setAttr(win, "data-status", status);
      setText(winName, name);
      setText(winTool, tool ? `· ${tool}` : "");
      setHidden(winBadge, status === "live");
      setText(winBadge, status === "awaiting" ? "awaiting you" : "out of date");
      setAttr(remove, "aria-label", `Remove ${name} from the dock`);
      setAttr(minimise, "aria-label", `Dock ${name}`);
    }
    chatPane.classList.toggle("window-open", open !== null);
    // over the chat, on a narrow screen, the window is all there is to reach
    const inert = open !== null && !wide();
    if (transcript.inert !== inert) transcript.inert = inert;
    stack();
    onChange();
  }

  // Every streamed word reaches sync, so it writes only what has changed: a
  // dock that stays the same costs no style or layout work.
  function setText(el, text) {
    if (el.textContent !== text) el.textContent = text;
  }
  function setAttr(el, name, value) {
    if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  }
  function setHidden(el, hidden) {
    if (el.hidden !== hidden) el.hidden = hidden;
  }

  // The window sits above the status line and the composer, or on a narrow
  // screen over everything down to the composer: their heights, as they are.
  function measure() {
    chatPane.style.setProperty("--hai-composer-height", `${composer.offsetHeight}px`);
    chatPane.style.setProperty("--hai-foot", `${composer.offsetHeight + statusEl.offsetHeight}px`);
  }

  // Into the pile, oldest first, until the row fits. Measured, so it does
  // nothing where nothing is laid out.
  let listed = "";
  /** Each piled surface's row in the list, as last built. */
  const rows = new Map();
  // Measured again only when what decides it changes: which surfaces are
  // docked, in what order, their names, their dots, which is open; or the
  // room, when the observer below says so.
  let measured = null;
  function stack(force = false) {
    const focused = document.activeElement;
    const inputs = entries.map((e) => `${e.block.id}:${nameOf(e)}:${statusOf(e) === "awaiting"}:${e === open}`).join(" ");
    if (force || inputs !== measured) {
      measured = inputs;
      for (const entry of entries) entry.item.hidden = false;
      pile.hidden = true;
      const stackable = entries.filter((e) => e !== open && statusOf(e) !== "awaiting");
      let piled = 0;
      while (row.scrollWidth > row.clientWidth && piled < stackable.length) {
        stackable[piled++].item.hidden = true;
        pile.hidden = false;
        pileText.textContent = `${piled} more`;
      }
      for (const entry of entries) entry.stacked = stackable.indexOf(entry) > -1 && stackable.indexOf(entry) < piled;
      // an item stacked under the reader's focus hands it to the pile, and a
      // pile that goes hands it to the item now at the row's end, where it was
      if (entries.some((e) => e.stacked && e.item === focused)) pileBtn.focus();
      else if (focused === pileBtn && pile.hidden) entries.filter((e) => !e.item.hidden).at(-1)?.item.focus();
    }
    const stacked = entries.filter((e) => e.stacked);
    const changed = stacked.filter((e) => e.changed).length;
    setHidden(pileMark, changed === 0);
    setAttr(pileBtn, "aria-label", `${stacked.length} more docked surfaces${changed ? `, ${changed} changed` : ""}`);
    if (!stacked.length) closePile(false);

    // The list, rebuilt only when what it shows changes: which surfaces, not
    // just their names, since two can share a component. A reader may be in
    // it, and keeps their place on the same surface's row.
    const key = stacked.map((e) => `${e.block.id}:${nameOf(e)}:${e.changed}`).join(" ");
    if (key === listed) return;
    listed = key;
    const focusedEntry = [...rows].find(([, row]) => row === focused)?.[0];
    rows.clear();
    list.replaceChildren(h("div", cls.pileHead, `stacked · ${stacked.length} · oldest first`));
    for (const entry of stacked) {
      const b = h("button", cls.pileRow);
      b.type = "button";
      b.append(icon("window", cls.pileRowIcon), h("span", cls.pileName, nameOf(entry)));
      if (entry.changed) {
        const mark = changedMark();
        mark.hidden = false;
        b.append(mark);
      }
      b.setAttribute("aria-label", `${nameOf(entry)}${entry.changed ? ", changed" : ""}`);
      b.onclick = () => show(entry);
      rows.set(entry, b);
      list.append(b);
    }
    // the reader stays on the same surface: its new row, or its item on the
    // shelf if it has left the pile
    if (focusedEntry) (rows.get(focusedEntry) ?? (focusedEntry.stacked ? null : focusedEntry.item))?.focus();
  }

  function openPile() {
    // no taller than the room above the shelf, in the chat: it scrolls
    const room = pile.getBoundingClientRect().top - chatPane.getBoundingClientRect().top - 30;
    list.style.maxHeight = room > 0 ? `${room}px` : "";
    list.hidden = false;
    pileBtn.setAttribute("aria-expanded", "true");
    list.querySelector("button")?.focus();
  }

  function closePile(focus) {
    if (list.hidden) return;
    list.hidden = true;
    pileBtn.setAttribute("aria-expanded", "false");
    if (focus) pileBtn.focus();
  }

  pileBtn.onclick = () => (list.hidden ? openPile() : closePile(true));

  // ── keys and clicks ──────────────────────────────────────────────────
  // Arrows move along the shelf, and up and down the pile's list.
  shelf.addEventListener("keydown", (e) => {
    const inList = list.contains(e.target);
    const keys = inList ? ["ArrowUp", "ArrowDown", "Home", "End"] : ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(e.key)) return;
    const buttons = inList
      ? [...list.querySelectorAll("button")]
      : [...shelf.querySelectorAll(".hai-dock-item, .hai-dock-clear")].filter((b) => !b.hidden && !b.closest("[hidden]"));
    const at = buttons.indexOf(e.target);
    if (at < 0) return;
    e.preventDefault();
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
    const next = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : (at + step + buttons.length) % buttons.length;
    buttons[next].focus();
  });

  // Escape closes the pile's list, then the window: from inside the dock, or
  // from anywhere while the drawer is closed. With the drawer open, Escape
  // from outside the dock is the drawer's, even with the list open behind it.
  // Unless something there used the key first, such as a surface closing a
  // menu of its own.
  const onKey = (e) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    const inside = win.contains(document.activeElement) || shelf.contains(document.activeElement);
    if (!inside && drawerOpen()) return;
    if (!list.hidden) {
      e.preventDefault();
      closePile(inside);
      return;
    }
    if (!open) return;
    e.preventDefault();
    close(inside);
  };
  shell.addEventListener("keydown", onKey);

  // a click away from the pile's list closes it, and on a narrow screen a tap
  // on the chat the window covers docks it again, as a tap outside a sheet does
  shell.addEventListener("pointerdown", (e) => {
    if (!list.hidden && !pile.contains(e.target)) closePile(false);
  });
  chatPane.addEventListener("click", (e) => {
    if (e.target === chatPane && transcript.inert) close(true);
  });

  // Across the breakpoint the shelf's count comes or goes, so the row's room
  // changes though the composer's width may not, and no resize says so.
  const onResize = () => {
    measured = null;
    sync();
  };
  wideQuery?.addEventListener("change", onResize);
  // the room changed: the window's place, and what fits on the shelf
  const resized = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => (measure(), stack(true)));
  resized?.observe(composer);
  resized?.observe(statusEl);

  return {
    onDock,
    sync,
    /** Whether a surface waiting on the reader is in the dock. */
    waiting: () => entries.some((e) => statusOf(e) === "awaiting"),
    /** A new conversation: the last one's surfaces are gone, docked ones too. */
    clear() {
      closePile(false);
      open = null;
      win.hidden = true;
      for (const entry of entries) {
        entry.item.remove();
        entry.element.remove();
      }
      entries.length = 0;
      sync();
    },
    release() {
      shell.removeEventListener("keydown", onKey);
      wideQuery?.removeEventListener("change", onResize);
      resized?.disconnect();
    },
  };
}

/** The accent square a docked surface wears while it has changed unseen. */
function changedMark() {
  const mark = h("span", cls.dockChanged);
  mark.setAttribute("aria-hidden", "true");
  mark.hidden = true;
  return mark;
}

/** A header button: an icon, and a label that narrow screens keep for screen
 *  readers only. */
function button(className, iconName, label) {
  const b = h("button", className);
  b.type = "button";
  b.append(icon(iconName), h("span", cls.btnLabel, label));
  return b;
}

/**
 * What the model context debug drawer shows. Makes the dual channel visible,
 * which is the whole argument — keep it on while developing.
 */
export function renderInspector(el, { messages = [], modelTokens = 0, uiTokens = 0 } = {}) {
  // following the newest context, as the transcript does, unless scrolled up
  const following = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  el.replaceChildren();

  if (!messages.length && !modelTokens && !uiTokens) {
    el.append(
      h("p", cls.inspectorEmpty, "Nothing yet. Every message, tool call and digest the model receives shows up here."),
    );
    return;
  }

  const total = modelTokens + uiTokens;
  const pct = uiTokens ? Math.round((1 - modelTokens / total) * 100) : 0;
  const stats = h("div", cls.ctx);
  if (uiTokens) {
    const headline = h("div", cls.ctxHeadline);
    headline.append(h("span", cls.ctxPct, `${pct}%`), h("span", null, "kept out of context"));
    stats.append(headline);
  }
  const meter = h("div", cls.meter);
  meter.setAttribute("aria-hidden", "true");
  const share = h("span", cls.meterModel);
  share.style.width = `${total ? (modelTokens / total) * 100 : 100}%`;
  meter.append(share);
  stats.append(
    meter,
    stat(cls.keyModel, "model context", modelTokens),
    stat(cls.keyUi, "browser payload", uiTokens),
  );
  el.append(stats);

  for (const m of messages) {
    const box = h("div", `${cls.msg} hai-msg-${m.role}`);
    box.append(h("div", cls.role, m.role));
    const body = h("div", cls.mbody);
    if (typeof m.content === "string") {
      body.append(h("div", null, m.content));
    } else {
      for (const b of m.content ?? []) {
        if (b.type === "text" && b.text) body.append(h("div", null, b.text));
        if (b.type === "tool_use") {
          const call = h("div", cls.toolUse);
          call.append(h("span", cls.kind, `tool_use · ${b.name}`), h("div", null, JSON.stringify(b.input)));
          body.append(call);
        }
        if (b.type === "tool_result") {
          const result = h("div", cls.toolResult);
          result.append(h("span", cls.kind, "tool_result"), h("div", null, plain(b.content)));
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
  const row = h("div", cls.ctxStat);
  const name = h("span", cls.ctxLabel);
  name.append(h("i", key), label);
  row.append(name, h("span", cls.ctxTok, `~${tokens.toLocaleString()} tok`));
  return row;
}

/** A tool_result's content as text: a string, or an array of content blocks. */
function plain(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => c?.text ?? JSON.stringify(c)).join("\n");
  return JSON.stringify(content);
}
