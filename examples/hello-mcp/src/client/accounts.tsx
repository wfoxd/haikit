import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ACCOUNTS } from "../shared/surfaces.ts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { connect, WHY_NOT } from "./connect.ts";

/** One of `GET /mcp/connections`'s servers: `McpAccount`. */
interface Account {
  name: string;
  scope: string | null;
  connectedAt: number;
}

/**
 * The settings panel: the accounts the user has connected, from
 * `GET /mcp/connections`, each with a button that disconnects it,
 * `POST /mcp/disconnect/<server>`, and a button to connect one that isn't.
 * Both routes are `mcpAuth.handler()`'s, and act for whoever is signed in.
 */
function Accounts({ buttonClass }: { buttonClass: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  // what went wrong, and, for a connect, its link to open in a tab instead
  const [problem, setProblem] = useState<{ text: string; server?: string; href?: string } | null>(null);

  const load = async () => {
    const res = await fetch("/mcp/connections");
    const servers = res.ok ? ((await res.json()) as { servers: Account[] }).servers : [];
    setAccounts(servers);
    // connected since, as in a tab: the problem is over
    setProblem((p) => (p?.server && servers.some((a) => a.name === p.server) ? null : p));
  };
  // back from a tab opened from the link below: show what it did
  useEffect(() => {
    const back = () => {
      if (dialog.current?.open) void load();
    };
    window.addEventListener("focus", back);
    return () => window.removeEventListener("focus", back);
  }, []);
  const open = () => {
    setProblem(null);
    dialog.current?.showModal();
    void load();
  };
  const disconnect = async (server: string) => {
    // revoked at Notes, deleted here, and the user's connection closed: the next call shows the connect card
    const res = await fetch(`/mcp/disconnect/${encodeURIComponent(server)}`, { method: "POST" });
    setProblem(res.ok ? null : { text: "That didn't disconnect. Try again." });
    await load();
  };
  const connectTo = async (server: string) => {
    // no conversation in the link, so this wakes none
    const href = `/mcp/connect/${encodeURIComponent(server)}`;
    const answer = await connect(href);
    setProblem(answer.ok ? null : { text: WHY_NOT[answer.error ?? "failed"] ?? WHY_NOT.failed!, server, href });
    await load();
  };

  return (
    <>
      <button type="button" className={buttonClass} onClick={open} aria-haspopup="dialog">
        Accounts
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="accounts-title"
        className="m-auto w-[min(26rem,calc(100vw-32px))] rounded-lg border border-border bg-background p-4 text-foreground backdrop:bg-black/40"
      >
        <h2 id="accounts-title" className="mb-1 font-heading text-base">
          Accounts
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">Who this app is, to each service it calls for you.</p>
        <ul className="mb-3 flex flex-col">
          {Object.entries(ACCOUNTS).map(([server, label]) => {
            const account = accounts?.find((a) => a.name === server);
            return (
              <li key={server} className="flex items-center gap-3 border-b border-border/40 py-2">
                <span className="flex-1">
                  {label}
                  <span className="block text-xs text-muted-foreground">
                    {accounts === null
                      ? "…"
                      : account
                        ? `Your own account, connected ${new Date(account.connectedAt).toLocaleString()}${account.scope ? `, for ${account.scope}` : ""}`
                        : "Not connected"}
                  </span>
                </span>
                {accounts === null ? null : account ? (
                  <Button size="sm" variant="outline" onClick={() => disconnect(server)}>
                    Disconnect
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => connectTo(server)}>
                    Connect
                  </Button>
                )}
              </li>
            );
          })}
          <li className="flex items-center gap-3 border-b border-border/40 py-2">
            <span className="flex-1">
              Calendar
              <span className="block text-xs text-muted-foreground">Your own key, which this app keeps for you</span>
            </span>
            <Badge variant="outline">key</Badge>
          </li>
          <li className="flex items-center gap-3 py-2">
            <span className="flex-1">
              Almanac
              <span className="block text-xs text-muted-foreground">This app's own key, the same for everyone</span>
            </span>
            <Badge variant="outline">the app</Badge>
          </li>
        </ul>
        {problem ? (
          <p role="alert" className="mb-3 text-sm text-muted-foreground">
            {problem.text}{" "}
            {/* a link isn't blocked, as the card's isn't; the list reloads when the user comes back */}
            {problem.href ? (
              <a className="underline" href={problem.href} target="_blank">
                Open it in a tab
              </a>
            ) : null}
          </p>
        ) : null}
        <form method="dialog" className="flex justify-end">
          <Button size="sm" variant="outline">
            Close
          </Button>
        </form>
      </dialog>
    </>
  );
}

/** Puts the Accounts button in the chat's header, before New chat, styled as it is. */
export function mountAccounts(actions: Element | null) {
  if (!actions) return;
  const el = document.createElement("div");
  el.style.display = "contents";
  const like = actions.querySelector("button")?.className ?? "";
  actions.prepend(el);
  createRoot(el).render(<Accounts buttonClass={like} />);
}
