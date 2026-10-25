import { useEffect, useState } from "react";
import type { Chat, ChatState } from "@haikit/client";
import { Badge } from "@/components/ui/badge";

const countOf = (state: ChatState) => (state.signals.online as { count?: number } | undefined)?.count ?? 0;

/**
 * How many people are reading now: the server's `online` signal, a
 * broadcast to every open tab. It never enters the transcript or the
 * guide's context; this chip shows the latest count, and hides on a phone.
 */
export function Online({ chat }: { chat: Chat }) {
  // a count may have come before this mounted: subscribers hear only what comes next
  const [count, setCount] = useState(() => countOf(chat.state));
  useEffect(
    () =>
      chat.subscribe((state, event) => {
        if (event.type === "signal" && event.name === "online") setCount(countOf(state));
      }),
    [chat],
  );
  if (count < 1) return null;
  return (
    <Badge
      variant="outline"
      title={count === 1 ? "You're the only one here right now" : `${count} people have the introduction open`}
      className="mr-1.5 h-6 gap-1.5 px-2.5 font-mono text-xs font-normal text-muted-foreground max-[560px]:hidden"
    >
      <span aria-hidden className="size-1.5 rounded-full bg-hai-good" />
      {count} reading now
    </Badge>
  );
}
