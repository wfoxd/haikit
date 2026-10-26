/**
 * The Airline ops panel: a bar under the header that plays the airline.
 *
 * It isn't part of the conversation. Its buttons call the demo server's
 * /ops routes, which act on this conversation the way an airline's systems
 * would: a notice for news, a revision for what's already on screen. So you
 * watch the outside world act, then the AI respond.
 *
 * Nothing happens until the airline acts, so a visitor who doesn't press
 * anything isn't left waiting: 30 seconds after the trip opens, the panel
 * cancels the flight itself, through the same route as its button. A visitor
 * who starts booking the flight home is doing something already, so then it
 * doesn't.
 */

import { useEffect, useRef, useState } from "react";
import type { Chat } from "@haikit/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** What each button asks the airline to do. */
const ACTIONS = [
  { route: "cancel", label: "Cancel the flight", hint: "The airline cancels UA 837. The guide hears of it and speaks first." },
  { route: "release", label: "Release the holds", hint: "The 5-minute seat holds run out now: seats left fall, and one option sells out." },
  { route: "gate", label: "Change the gate", hint: "The new flight's gate moves. The boarding pass is revised, and the guide speaks up." },
  { route: "fare", label: "Raise the fare", hint: "While you review the flight home, its fare goes up $60. The review is revised in place; a Confirm at the old total is refused." },
] as const;
type Action = (typeof ACTIONS)[number];

/** How long after the trip opens the airline cancels the flight by itself. */
const AUTO_CANCEL_MS = 30_000;

export function OpsBar({ chat }: { chat: Chat }) {
  const [status, setStatus] = useState({ text: "Start here: cancel the flight.", refused: false });
  const say = (text: string, refused = false) => setStatus({ text, refused });

  const [busy, setBusy] = useState(false);
  // read by the countdown, between renders
  const busyNow = useRef(false);
  /**
   * Ask the airline to do something to this conversation.
   * @param lead said before the airline's answer
   */
  const run = async (action: Action, lead = "") => {
    const conversationId = chat.state.conversationId;
    if (busyNow.current || !conversationId) return;
    busyNow.current = true;
    setBusy(true);
    try {
      const res = await fetch(`/ops/${action.route}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId }),
      });
      const body = await res.json().catch(() => ({}));
      say(`${lead}${body.message ?? `The airline answered ${res.status}.`}`, !res.ok);
    } catch {
      say("The airline couldn't be reached.", true);
    } finally {
      busyNow.current = false;
      setBusy(false);
    }
  };

  // ── the airline cancels by itself, if nobody does ─────────────────────
  /** Seconds left on the countdown, while it runs. */
  const [left, setLeft] = useState<number | null>(null);
  const countdown = useRef<{ tick: ReturnType<typeof setInterval>; due: ReturnType<typeof setTimeout> } | null>(null);
  /** A cancellation that came due while another request was going, waiting for it to finish. */
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The countdown stands down: a cancellation was sent or seen, or the visitor is booking the flight home. */
  const cancelling = useRef(false);
  /** The conversation the countdown last started for: it starts once, with the trip that opens it. */
  const counted = useRef<string | null>(null);

  const stopCountdown = () => {
    // a cancellation already due stands down with it
    if (retry.current) clearTimeout(retry.current);
    retry.current = null;
    if (!countdown.current) return;
    clearInterval(countdown.current.tick);
    clearTimeout(countdown.current.due);
    countdown.current = null;
    setLeft(null);
  };

  const startCountdown = (conversationId: string) => {
    stopCountdown();
    cancelling.current = false;
    counted.current = conversationId;
    const ends = Date.now() + AUTO_CANCEL_MS;
    const show = () => setLeft(Math.max(0, Math.ceil((ends - Date.now()) / 1000)));
    show();
    say(`If you don't cancel UA 837, the airline will, in ${AUTO_CANCEL_MS / 1000} seconds.`);
    countdown.current = {
      tick: setInterval(show, 1_000),
      due: setTimeout(() => {
        stopCountdown();
        const fire = () => {
          // only for the conversation it was started for, while nobody has
          // cancelled it: a new chat starts its own
          if (chat.state.conversationId !== conversationId || cancelling.current) return;
          // another of the airline's requests is still going: cancel once it's done
          if (busyNow.current) return void (retry.current = setTimeout(fire, 300));
          retry.current = null;
          cancelling.current = true;
          void run(ACTIONS[0], `Nobody cancelled it, so after ${AUTO_CANCEL_MS / 1000} seconds the airline did. `);
        };
        fire();
      }, AUTO_CANCEL_MS),
    };
  };

  useEffect(() => {
    const off = chat.subscribe((state, event) => {
      // A trip opens: the countdown starts. Its revision, or the cancellation
      // notice, means the flight is cancelled, whoever did it, or the flight
      // home is booked: either way, nothing is left to start. The trip card
      // shown again later, by show_bookings, starts nothing: the countdown
      // belongs to the trip that opened the conversation.
      if (event.type === "ui_open" && event.component === "trip_card" && !event.replaces) {
        if (state.conversationId && counted.current !== state.conversationId) startCountdown(state.conversationId);
      } else if ((event.type === "ui_open" && event.component === "trip_card") || (event.type === "notice" && event.name === "flight_cancelled")) {
        cancelling.current = true;
        stopCountdown();
      } else if (event.type === "ui_open" && event.component === "flight_search") {
        // The visitor is booking the flight home: the airline doesn't interrupt,
        // and that includes a cancellation already due, waiting on a busy
        // request to retry. Only a countdown still showing needs the word.
        const counting = countdown.current !== null;
        cancelling.current = true;
        stopCountdown();
        if (counting) say("You're booking the flight home, so the airline won't cancel UA 837 by itself. Press Cancel the flight whenever you like.");
      } else if (["reset", "closed"].includes((event as { type: string }).type)) {
        // the chat's own events, not the server's: a new conversation, or none
        stopCountdown();
      }
    });
    // mountChat started the conversation before this ran, and subscribers
    // hear only what comes next: catch up with where it already is. The
    // trip open and nothing done yet starts the countdown; the flight
    // cancelled, or the flight home begun, leaves nothing to start.
    const { conversationId, surfaces, notices } = chat.state;
    const shown = [...surfaces.values()];
    if (conversationId && counted.current !== conversationId && shown.some((s) => s.component === "trip_card")) {
      const cancelled =
        notices.some((n) => n.name === "flight_cancelled") ||
        shown.some((s) => s.component === "flight_search" || (s.component === "trip_card" && (s.props as { status?: string } | null)?.status === "cancelled"));
      if (cancelled) {
        counted.current = conversationId;
        cancelling.current = true;
      } else {
        startCountdown(conversationId);
      }
    }
    return () => {
      off();
      stopCountdown();
    };
  }, [chat]);

  const press = (action: Action) => {
    // Another request is still going, so this click does nothing: leave the
    // countdown be, or nothing would cancel the flight.
    if (busyNow.current) return;
    if (action.route === "cancel") {
      cancelling.current = true;
      stopCountdown();
    }
    void run(action);
  };

  return (
    <TooltipProvider>
      <section
        aria-label="Airline ops: plays the airline"
        className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-b border-hai-line bg-[repeating-linear-gradient(-45deg,var(--hai-panel-2)_0_10px,var(--hai-panel)_10px_20px)] px-4 py-[9px]"
      >
        <p className="flex items-baseline gap-2 font-mono text-xs font-bold tracking-[0.08em] text-hai-bad uppercase">
          Airline ops
          <span className="font-sans text-xs font-medium tracking-normal text-muted-foreground normal-case">plays the airline</span>
        </p>
        <div className="flex flex-wrap gap-1.5">
          {ACTIONS.map((action) => (
            <Tooltip key={action.route}>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => press(action)}
                  className={cn("text-[13px] hover:border-hai-bad hover:text-hai-bad", busy && "cursor-progress opacity-60")}
                >
                  {action.label}
                  {/* seconds until the airline cancels by itself, on the button that does it now;
                      the status line says it once, and a number read out every second would drown it */}
                  {action.route === "cancel" && left !== null && (
                    <Badge aria-hidden className="ml-1 h-5 bg-hai-bad/15 px-1.5 font-mono text-[11.5px] font-semibold text-hai-bad tabular-nums">
                      {`${left}s`}
                    </Badge>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-[280px] text-pretty">{action.hint}</TooltipContent>
            </Tooltip>
          ))}
        </div>
        <p aria-live="polite" className={cn("min-w-0 flex-[1_1_260px] text-[13px] text-muted-foreground", status.refused && "text-hai-warn")}>
          {status.text}
        </p>
      </section>
    </TooltipProvider>
  );
}
