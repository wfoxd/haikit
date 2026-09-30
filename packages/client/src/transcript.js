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
  const follow = follower(root);

  // reset() gives a new conversation a new blocks array, and a new
  // conversation starts at the bottom, wherever the reader was in the last.
  if (state.blocks !== follow.blocks) Object.assign(follow, { blocks: state.blocks, stick: true, top: 0 });
  // A scroll the reader made since the last render, whose event hasn't arrived
  // yet: taken now, or the pin below would overwrite it. Not while an earlier
  // render in this task is still mounting: the reader can't scroll within a
  // task, and the position read then is one clamped to a shorter transcript.
  else if (!follow.mounting) follow.noticeScroll();

  root.replaceChildren();
  for (const block of state.blocks) root.append(renderBlock(block, chat));

  // Surfaces mount in microtasks queued by renderBlock, in block order. This
  // one is queued after them, so it runs once they have content and height:
  // scrolling any earlier aims at a bottom that is about to move.
  follow.mounting = true;
  queueMicrotask(() => {
    follow.mounting = false;
    follow.stick ? follow.pin() : follow.hold();
  });

  // Surfaces can grow after they mount, as a table expands or an image loads.
  // While following, the observer keeps the newest content in view as they do.
  // Otherwise it returns the reader to their place, which a rebuild may have
  // had to clamp while the surfaces above it were still short. The browser
  // reports scrolls before resizes in a frame, so a scroll the reader has just
  // made is already their place by then.
  if (follow.observer) {
    follow.observer.disconnect();
    follow.observer.observe(root);
    for (const child of root.children) follow.observer.observe(child);
  }
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
    // a render's surfaces are still to mount
    mounting: false,
    // the reader has scrolled, unless this is where the transcript's own
    // last scroll landed
    noticeScroll() {
      if (landed !== null && Math.abs(root.scrollTop - landed) < 1) return;
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
  };

  root.addEventListener("scroll", () => follow.noticeScroll(), { passive: true });

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

    case "interaction": {
      const el = h("div", "hai-block hai-interaction");
      el.append(h("span", "hai-arrow", "↳"), h("span", null, block.label));
      return el;
    }

    case "error":
      return h("div", "hai-block hai-error", `error: ${block.message}`);

    // The conversation is closed, so the notice carries the only way forward.
    case "expired": {
      const el = h("div", "hai-block hai-expired");
      const again = h("button", "hai-new", "Start a new conversation");
      again.onclick = () => chat.reset();
      el.append(h("div", "hai-body", block.message), again);
      return el;
    }

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
