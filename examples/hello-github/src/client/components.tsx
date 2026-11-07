import { useState, type ReactNode } from "react";
import { reactNotice, reactSurface, type NoticeProps, type SurfaceProps } from "@haikit/react";
// types only: @haikit/mcp runs on the server
import type { accountConnected, connectCard } from "@haikit/mcp";
import type { greetingCard, greetingPicker, issueList } from "../shared/surfaces.ts";
import { ACCOUNTS } from "../shared/surfaces.ts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { connect, WHY_NOT } from "./connect.ts";

function GreetingPicker({ props, send, mode, state, selection }: SurfaceProps<typeof greetingPicker>) {
  const [script, setScript] = useState("all");
  const live = state === "live" && mode === "elicit";

  const scripts = [...new Set(props.greetings.map((g) => g.script))].sort();
  const rows = props.greetings.filter((g) => script === "all" || g.script === script);
  const choose = (code: string) => send("choose", code);

  return (
    <Card className="gap-3 rounded-none bg-transparent py-3 shadow-none ring-0">
      <CardHeader className="px-3">
        <CardTitle>Pick a language</CardTitle>
        <CardDescription>
          {rows.length} of {props.greetings.length} greetings
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 px-3">
        <ToggleGroup type="single" variant="outline" size="sm" className="flex-wrap" value={script} onValueChange={(v) => v && setScript(v)}>
          {["all", ...scripts].map((sc) => (
            <ToggleGroupItem key={sc} value={sc}>
              {sc}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div>
          {rows.map((g) => (
            <div key={g.code} className="flex items-center gap-3 border-b border-border/40 py-1.5">
              <span className="flex-1 text-[15px]" dir={g.rtl ? "rtl" : undefined}>
                {g.text}
              </span>
              <Tooltip>
                <TooltipTrigger className="font-mono text-xs text-muted-foreground">{g.language}</TooltipTrigger>
                <TooltipContent>{g.speakersM}M speakers</TooltipContent>
              </Tooltip>
              {live ? (
                <Button size="sm" variant="outline" aria-label={`Choose ${g.language}`} onClick={() => choose(g.code)}>
                  Choose
                </Button>
              ) : g.code === selection ? (
                <Badge>picked</Badge>
              ) : null}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// A display surface never parks the turn, so it is never frozen and there is
// nothing to resolve. `copy` is an `inform`: a line added to the
// conversation after the fact.
function GreetingCard({ props: { greeting: g }, send }: SurfaceProps<typeof greetingCard>) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard?.writeText(g.text).catch(() => {});
    setCopied(true);
    void send("copy", { code: g.code });
  };

  return (
    <Card className="rounded-none bg-transparent shadow-none ring-0">
      <CardHeader>
        <CardTitle className="text-[28px] leading-tight" dir={g.rtl ? "rtl" : undefined}>
          {g.text}
        </CardTitle>
        <CardDescription className="font-mono text-xs">
          {g.language} · {g.script} · {g.speakersM}M speakers
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button size="sm" variant="outline" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </CardContent>
    </Card>
  );
}

function Providers({ children }: { children: ReactNode }) {
  return <TooltipProvider>{children}</TooltipProvider>;
}

const plain = "gap-3 rounded-none bg-transparent py-3 shadow-none ring-0";

/**
 * The connect card. Its button opens the link from `err.auth.connect` in a
 * popup, from the click, and hears how it went from the done page. Once the
 * user has connected, the server's `account_connected` notice wakes the
 * conversation, so the card itself sends nothing.
 */
function ConnectCard({ props: { label, need, href } }: SurfaceProps<typeof connectCard>) {
  const [state, setState] = useState<"idle" | "waiting" | "connected">("idle");
  const [problem, setProblem] = useState("");
  const go = async () => {
    setState("waiting");
    setProblem("");
    const answer = await connect(href);
    setState(answer.ok ? "connected" : "idle");
    if (!answer.ok) setProblem(WHY_NOT[answer.error ?? "failed"] ?? WHY_NOT.failed!);
  };
  const title = need === "scope" ? `Give ${label} more access` : need === "reconnect" ? `Connect ${label} again` : `Connect ${label}`;
  const why =
    need === "scope"
      ? `${label} needs more access for this.`
      : need === "reconnect"
        ? `${label} no longer takes your sign-in.`
        : `Sign in to ${label} once, and every conversation of yours can use it.`;

  return (
    <Card className={plain}>
      <CardHeader className="px-3">
        <CardTitle>{title}</CardTitle>
        <CardDescription>{why}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3 px-3">
        {state === "connected" ? (
          <Badge>Connected</Badge>
        ) : (
          <Button size="sm" onClick={go} disabled={state === "waiting"}>
            {state === "waiting" ? "Waiting for you to sign in…" : title}
          </Button>
        )}
        {problem ? (
          <span role="alert" className="text-sm text-muted-foreground">
            {problem}{" "}
            {/* a link isn't blocked; its done page says when to close the tab, and the notice wakes the chat */}
            <a className="underline" href={href} target="_blank">
              Open it in a tab
            </a>
          </span>
        ) : null}
      </CardContent>
    </Card>
  );
}

// Every word here is GitHub's, or whoever opened the issue's: React writes it as text, never as markup.
function IssueList({ props: { query, total, issues } }: SurfaceProps<typeof issueList>) {
  return (
    <Card className={plain}>
      <CardHeader className="px-3">
        <CardTitle>Issues</CardTitle>
        <CardDescription>
          {total === issues.length ? total : `${issues.length} of ${total}`} matching “{query}”
        </CardDescription>
      </CardHeader>
      <CardContent className="px-3">
        {issues.map((i) => (
          <div key={i.url} className="flex items-baseline gap-3 border-b border-border/40 py-1.5">
            <a className="flex-1 text-[15px] hover:underline" href={i.url} target="_blank" rel="noreferrer" dir="auto">
              {i.title}
            </a>
            <span className="font-mono text-xs text-muted-foreground">
              {i.repo}#{i.number} · {i.author}
            </span>
            <Badge variant={i.state === "open" ? "default" : "outline"}>{i.state}</Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export const registry = {
  greeting_picker: reactSurface(GreetingPicker, { wrapper: Providers }),
  greeting_card: reactSurface(GreetingCard, { wrapper: Providers }),
  connect_card: reactSurface(ConnectCard),
  issue_list: reactSurface(IssueList),
};

function AccountConnected({ payload }: NoticeProps<typeof accountConnected>) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1.5 px-3 py-2.25">
      <span>Connected {ACCOUNTS[payload.server] ?? payload.server}.</span>
      <Badge variant="secondary">account</Badge>
    </div>
  );
}

export const notices = {
  account_connected: reactNotice(AccountConnected),
};
