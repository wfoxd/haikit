import { useState } from "react";
import { reactNotice, reactSurface, type NoticeProps, type SurfaceProps } from "@haikit/react";
// types only: @haikit/mcp runs on the server
import type { accountConnected, connectCard } from "@haikit/mcp";
import type { noteDraft, noteList } from "../shared/surfaces.ts";
import { ACCOUNTS } from "../shared/surfaces.ts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { connect, WHY_NOT } from "./connect.ts";

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

function NoteList({ props: { account, notes } }: SurfaceProps<typeof noteList>) {
  return (
    <Card className={plain}>
      <CardHeader className="px-3">
        <CardTitle>Notes</CardTitle>
        <CardDescription>
          {notes.length} of {account}'s notes, newest first
        </CardDescription>
      </CardHeader>
      <CardContent className="px-3">
        {notes.map((n) => (
          <div key={n.id} className="flex items-baseline gap-3 border-b border-border/40 py-1.5">
            <span className="flex-1 text-[15px]">{n.text}</span>
            <time className="font-mono text-xs text-muted-foreground" dateTime={n.createdAt}>
              {new Date(n.createdAt).toLocaleDateString()}
            </time>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** The approval: nothing is written to Notes until the user clicks Save. */
function NoteDraft({ props: { text, account, count }, send, state, mode, selection }: SurfaceProps<typeof noteDraft>) {
  const live = state === "live" && mode === "elicit";
  return (
    <Card className={plain}>
      <CardHeader className="px-3">
        <CardTitle>{live ? "Save this note?" : "A note for Notes"}</CardTitle>
        <CardDescription>
          To {account}'s account, which has {count} {count === 1 ? "note" : "notes"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-3">
        <p className="border-l-2 border-border pl-3 text-[15px]">{text}</p>
        {live ? (
          <div className="flex gap-2">
            <Button size="sm" onClick={() => send("decide", "save")}>
              Save
            </Button>
            <Button size="sm" variant="outline" onClick={() => send("decide", "discard")}>
              Discard
            </Button>
          </div>
        ) : selection ? (
          // the button clicked, not how it went: a Save can still be refused, and the
          // chat shows the outcome, the click's label, under the draft
          <Badge variant={selection === "save" ? "default" : "outline"}>{selection === "save" ? "Save clicked" : "Discard clicked"}</Badge>
        ) : null}
      </CardContent>
    </Card>
  );
}

export const registry = {
  connect_card: reactSurface(ConnectCard),
  note_list: reactSurface(NoteList),
  note_draft: reactSurface(NoteDraft),
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
