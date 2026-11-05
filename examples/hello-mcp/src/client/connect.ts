/** What `@haikit/mcp`'s done page posts to the window that opened it. */
export interface DoneMessage {
  type: "haikit:mcp";
  server?: string;
  ok: boolean;
  error?: "signed_out" | "access_denied" | "expired" | "refused" | "failed";
}

/** What each way connecting can fail means to the person trying. */
export const WHY_NOT: Record<string, string> = {
  signed_out: "Sign in to this app, then try again.",
  access_denied: "Access wasn't allowed.",
  expired: "That took too long. Try again.",
  refused: "You're signed in here as someone else.",
  failed: "Something went wrong. Try again.",
  closed: "The window was closed before connecting.",
  blocked: "The browser blocked the window.",
};

/**
 * Opens a connect link in a popup, so the chat stays where it is, and
 * resolves with what the done page posts once the user is back: from this
 * app's own origin, from that popup, and nothing else. Call it from a click,
 * or the browser blocks the popup.
 *
 * Each call opens a window of its own: one name for all of them would let a
 * second flow, such as the settings panel's, replace a card's, whose listener
 * would then take the second's answer for its own.
 */
let opened = 0;
export function connect(href: string): Promise<DoneMessage | { ok: false; error: "closed" | "blocked" }> {
  const popup = window.open(href, `haikit-connect-${++opened}`, "popup,width=480,height=640");
  if (!popup) return Promise.resolve({ ok: false, error: "blocked" });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (answer: DoneMessage | { ok: false; error: "closed" }) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", heard);
      clearInterval(watching);
      resolve(answer);
    };
    const heard = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.source !== popup || e.data?.type !== "haikit:mcp") return;
      finish(e.data as DoneMessage);
    };
    // closed with no answer; a moment's grace for a message posted just as it closed
    const watching = setInterval(() => popup.closed && setTimeout(() => finish({ ok: false, error: "closed" }), 300), 500);
    window.addEventListener("message", heard);
  });
}
