/**
 * A default transcript renderer. Deliberately plain — data-dense agentic UIs
 * are bespoke, and this is the part you are expected to replace. It exists so
 * an app can be running in ten lines.
 *
 * Everything uses textContent. Tool payloads are untrusted input.
 */

import { icon } from "./icons.js";

export const h = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

export function renderTranscript(root, chat) {
  const { state } = chat;
  const follow = follower(root);

  // reset() gives a new conversation a new blocks array, and a new
  // conversation starts at the bottom, wherever the reader was in the last.
  // Its elements are all new too: the old surfaces are already unmounted.
  if (state.blocks !== follow.blocks) {
    // the last conversation's elements may already be gone from the page; they
    // stop being observed either way
    for (const { el } of follow.shown.values()) follow.observer?.unobserve(el);
    Object.assign(follow, { blocks: state.blocks, shown: new Map(), stick: true, top: 0 });
  }
  // A scroll the reader made since the last render, whose event hasn't arrived
  // yet: taken now, or the pin below would overwrite it. Not while an earlier
  // render in this task is still mounting: the reader can't scroll within a
  // task, and the position read then is one clamped to a shorter transcript.
  else if (!follow.mounting) follow.noticeScroll();

  // A block keeps its element for as long as what it shows is unchanged, so a
  // surface mounts once rather than on every event, and whatever its component
  // holds — a filter, an expanded row, a React tree — lives as long as it does.
  const shown = new Map();
  const elements = state.blocks.map((block) => {
    const look = appearance(block, chat);
    const before = follow.shown.get(block.id);
    let el = before?.el;
    if (before?.look !== look) {
      el = renderBlock(block, chat);
      // an expanded tool row stays expanded when its status changes
      if (before?.el.open) el.open = true;
    } else if (block.kind === "ui" && el.dataset.handle !== block.handle) {
      // a revision moved this surface to a new handle; its element stays
      el.dataset.handle = block.handle;
    } else if (block.progress !== before.progress) {
      // Progress changes the row in place. Rebuilt for every frame, a row a
      // keyboard user is on would take their focus up to ten times a second.
      const parts = rowParts.get(el);
      if (parts) showStatus(parts, block, toolStatus(block, chat));
    }
    shown.set(block.id, { el, look, progress: block.progress });
    return el;
  });
  follow.shown = shown;
  place(root, elements, follow.observer);

  // Surfaces mount in microtasks queued by renderBlock, in block order. This
  // one is queued after them, so it runs once they have content and height:
  // scrolling any earlier aims at a bottom that is about to move.
  follow.mounting = true;
  queueMicrotask(() => {
    follow.mounting = false;
    follow.stick ? follow.pin() : follow.hold();
  });
}

/**
 * Stop following a transcript that is going away: its resize observer and
 * scroll listener let go of it. `mountChat` does this when its chat closes; a
 * page rendering a transcript itself does it when it removes one.
 */
export function closeTranscript(root) {
  followers.get(root)?.close();
  followers.delete(root);
}

/** What a block's element shows. While this is unchanged, the element is kept. */
function appearance(block, chat) {
  // a surface shows a skeleton until its props arrive, and then itself for good
  if (block.kind === "ui") return chat.state.surfaces.get(block.handle)?.props ? "mounted" : "loading";
  // progress is left out: it changes the row in place (see renderTranscript)
  if (block.kind === "tool") return JSON.stringify({ ...block, progress: undefined, status: toolStatus(block, chat) });
  return JSON.stringify(block);
}

/**
 * What a tool row says of its call. The server leaves an elicit tool's row
 * `awaiting` for good; the question has closed once its surface is frozen —
 * answered, or typed over — or the conversation is out of date. An answered
 * question stays answered when the conversation goes out of date. A tool can
 * show a display surface before its question, and that one never freezes, so
 * it is the elicit surface that says.
 */
function toolStatus(block, chat) {
  if (block.status !== "awaiting") return block.status;
  const { blocks, surfaces, expired } = chat.state;
  // Found once per row and kept: every answered question keeps its row
  // `awaiting`, and this runs for each of them on every streamed event. The
  // surface's block is kept, not its handle, which a revision moves on.
  let question = questions.get(block);
  if (question === undefined) {
    question = blocks.find(
      (b) => b.kind === "ui" && b.toolId === block.id && surfaces.get(b.handle)?.mode === "elicit",
    );
    if (question !== undefined) questions.set(block, question);
  }
  if (surfaces.get(question?.handle)?.state === "frozen") return "resolved";
  return expired ? "expired" : "awaiting";
}

/** A tool row's block → the block of the question it asked, once seen. */
const questions = new WeakMap();

const STATUS_TEXT = {
  running: () => "running…",
  awaiting: () => "awaiting you",
  resolved: () => "resolved",
  expired: () => "out of date",
  error: (ms) => `failed · ${ms} ms`,
};

/** "2/4", or "2" when the tool hasn't said how many in all. */
function progressCount({ done, total }) {
  return total !== undefined ? `${done ?? 0}/${total}` : done !== undefined ? String(done) : "";
}

/** A tool row's element → its status text and progress bar, which progress changes in place. */
const rowParts = new WeakMap();

/**
 * Fill in what a tool row says of its call. While it runs, that is its
 * progress once it has reported some: the message gives way first on a narrow
 * row, so the count stays readable, and the bar fills once there is a total.
 */
function showStatus({ status: text, bar }, block, status) {
  const progress = status === "running" ? block.progress : undefined;
  const message = progress?.message ?? "";
  const count = progress ? progressCount(progress) : "";
  if (message || count) {
    text.className = "hai-tstatus hai-tprogress";
    const parts = [];
    if (message) parts.push(h("span", "hai-tmessage", message));
    if (message && count) parts.push(h("span", null, " · "));
    if (count) parts.push(h("span", "hai-tcount", count));
    text.replaceChildren(...parts);
  } else {
    text.className = "hai-tstatus";
    text.textContent = (STATUS_TEXT[status] ?? ((ms) => `${ms} ms`))(block.ms);
  }

  if (!bar) return;
  const total = progress?.total;
  bar.hidden = !total;
  if (!total) return;
  const done = Math.min(progress.done ?? 0, total);
  bar.setAttribute("aria-valuemax", String(total));
  bar.setAttribute("aria-valuenow", String(done));
  bar.setAttribute("aria-valuetext", [message, `${done} of ${total}`].filter(Boolean).join(" · "));
  bar.style.setProperty("--hai-progress", `${(done / total) * 100}%`);
}

function statusMark(status) {
  const mark = h("span", "hai-ticon");
  if (status === "running") mark.append(h("span", "hai-spinner"));
  else if (status === "awaiting") mark.append(h("span", "hai-pulse"));
  else mark.append(icon(status === "error" ? "alert" : status === "expired" ? "clock" : "check"));
  return mark;
}

/**
 * Put `elements` in order under `root`, moving none that is already there:
 * one taken out and put back loses its scroll position and focus, and any
 * iframe or video in it starts over. Whatever else is there goes — a block's
 * old element, or something the page added after the last render.
 */
function place(root, elements, observer) {
  const wanted = new Set(elements);
  const drop = (node) => {
    const next = node.nextSibling;
    node.remove();
    // text and comments are dropped too, but only elements were ever observed
    if (node.nodeType === 1) observer?.unobserve(node);
    return next;
  };
  let at = root.firstChild;
  for (const el of elements) {
    while (at && !wanted.has(at)) at = drop(at);
    if (at === el) {
      at = at.nextSibling;
      continue;
    }
    root.insertBefore(el, at);
    // Surfaces can grow after they mount, as a table expands or an image
    // loads. While following, the observer keeps the newest content in view
    // as they do. Otherwise it returns the reader to their place, should a
    // surface above it have been short for a moment. The browser reports
    // scrolls before resizes in a frame, so a scroll the reader has just made
    // is already their place by then.
    observer?.observe(el);
  }
  while (at) at = drop(at);
}

/** Within this many pixels of the bottom, the reader is following new content. */
const NEAR_BOTTOM = 40;

const followers = new WeakMap();

/**
 * Whether a transcript follows new content, and where its reader is when it
 * doesn't, kept per element across renders.
 *
 * Only the reader's own scrolling changes either. Read from the geometry on
 * each render instead, both go wrong. Following breaks for good the first time
 * content grows after the scroll, which a surface mounting does every time: the
 * bottom is then too far away to count, and nothing scrolls there again. And
 * one chunk of the stream can render several times before any surface mounts,
 * so a later render reads a position the browser has already clamped to the
 * shorter transcript.
 */
function follower(root) {
  let follow = followers.get(root);
  if (follow) return follow;

  // where the transcript's own last scroll landed, so the scroll event that
  // follows is not taken for the reader's
  let landed = null;
  const land = () => (landed = root.scrollTop);

  follow = {
    stick: true,
    // where the reader last scrolled to
    top: 0,
    // the blocks array of the conversation shown
    blocks: null,
    // block id → { el, look }: the element showing each block, and what it shows
    shown: new Map(),
    // a render's surfaces are still to mount
    mounting: false,
    // the reader has scrolled, unless this is where the transcript's own
    // last scroll landed
    noticeScroll() {
      if (landed !== null && Math.abs(root.scrollTop - landed) < 1) return;
      // Content shrinking under a reader who scrolled up pulls them up to the
      // new bottom. That is the layout moving them, not the reader, whose own
      // scroll up always leaves the bottom: keep their place for when the
      // content grows back.
      const bottom = root.scrollHeight - root.clientHeight;
      if (!follow.stick && root.scrollTop < follow.top && root.scrollTop >= bottom - 1) return;
      landed = null;
      follow.top = root.scrollTop;
      follow.stick = root.scrollHeight - root.scrollTop - root.clientHeight < NEAR_BOTTOM;
    },
    pin() {
      root.scrollTop = root.scrollHeight;
      land();
    },
    // keep a reader who has scrolled up where they were, through a rebuild
    hold() {
      root.scrollTop = follow.top;
      land();
    },
    observer:
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => (follow.stick ? follow.pin() : follow.hold())),
    close() {
      follow.observer?.disconnect();
      root.removeEventListener("scroll", onScroll);
    },
  };

  const onScroll = () => follow.noticeScroll();
  root.addEventListener("scroll", onScroll, { passive: true });
  // the viewport itself: a window resized while following stays at the bottom
  follow.observer?.observe(root);

  followers.set(root, follow);
  return follow;
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

    // The user's answer, given in a surface rather than typed: it went back to
    // the model as the tool's result.
    case "interaction": {
      const el = h("div", "hai-block hai-interaction");
      const arrow = h("span", "hai-arrow");
      arrow.append(icon("reply"));
      el.append(arrow, h("span", "hai-body", block.label));
      return el;
    }

    case "error": {
      const el = h("div", "hai-block hai-error");
      el.setAttribute("role", "alert");
      el.append(icon("alert"), h("div", "hai-body", block.message));
      return el;
    }

    // The conversation is closed, so the notice carries the only way forward.
    case "expired": {
      const el = h("div", "hai-block hai-expired");
      const again = h("button", "hai-new", "Start a new conversation");
      again.type = "button";
      again.onclick = () => chat.reset();
      el.append(icon("clock"), h("div", "hai-body", block.message), again);
      return el;
    }

    // Provenance chrome. The tool row and its surface are one visual unit:
    // what produced this, with what arguments, and what the model got back.
    case "tool": {
      const status = toolStatus(block, chat);
      const el = h("details", `hai-block hai-tool hai-status-${status}`);
      const summary = h("summary");
      const parts = { status: h("span", "hai-tstatus"), bar: null };
      summary.append(
        statusMark(status),
        h("span", "hai-tname", block.name),
        h("span", "hai-targs", JSON.stringify(block.input)),
        parts.status,
        icon("chevron", "hai-icon hai-chevron"),
      );
      // a thin bar along the row's bottom edge, for progress with a total
      if (status === "running") {
        parts.bar = h("span", "hai-tbar");
        parts.bar.setAttribute("role", "progressbar");
        parts.bar.setAttribute("aria-label", `${block.name} progress`);
        parts.bar.setAttribute("aria-valuemin", "0");
        summary.append(parts.bar);
      }
      rowParts.set(el, parts);
      showStatus(parts, block, status);
      el.append(summary);
      const detail = h("div", "hai-tool-detail");
      detail.append(
        h("div", "hai-label", "input"),
        h("pre", "hai-code", JSON.stringify(block.input ?? {}, null, 2)),
        h("div", "hai-label", "→ tool_result — all the model receives"),
        h("pre", "hai-digest", block.result ?? "…"),
      );
      el.append(detail);
      return el;
    }

    case "ui": {
      const el = h("div", "hai-surface");
      el.dataset.handle = block.handle;
      const surface = chat.state.surfaces.get(block.handle);
      if (surface) el.dataset.component = surface.component;
      if (surface?.props) {
        queueMicrotask(() => chat.mount(block.handle, el));
      } else {
        el.setAttribute("aria-busy", "true");
        const skeleton = h("div", "hai-skeleton");
        skeleton.append(h("div", "hai-skeleton-label", `${surface?.component ?? "surface"} · loading…`));
        for (let i = 0; i < 3; i++) skeleton.append(h("div", "hai-shimmer"));
        el.append(skeleton);
      }
      return el;
    }

    // Something the server told this conversation outside of any request. The
    // label says what kind; the app's component, from the notices registry,
    // draws the rest. A status region, so a screen reader announces it.
    case "notice": {
      const el = h("div", "hai-notice");
      el.setAttribute("role", "status");
      el.dataset.notice = block.name;
      el.append(h("div", "hai-notice-label", `notice · ${block.name}`));
      const body = h("div", "hai-notice-body");
      el.append(body);
      queueMicrotask(() => chat.mountNotice(block.seq, body));
      return el;
    }

    default:
      return h("div", "hai-block", JSON.stringify(block));
  }
}
