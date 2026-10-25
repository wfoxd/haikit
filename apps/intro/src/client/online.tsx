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
  const [count, setCount] = useState(() => countOf(chat.state));
  useEffect(() => {
    const off = chat.subscribe((state, event) => {
      if (event.type === "signal" && event.name === "online") setCount(countOf(state));
    });
    // A count may have come since the first render: subscribers hear only
    // what comes next, and the server sends the count only when it changes.
    setCount(countOf(chat.state));
    return off;
  }, [chat]);
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
