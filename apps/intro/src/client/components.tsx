/**
 * The browser half of the course's surfaces: a React component for each,
 * registered under its surface's name.
 *
 * Typed against ../shared/surfaces.ts, the same contract the server
 * implements: change a prop or an action there and this side stops compiling.
 *
 * React writes text with textContent, never as HTML. Tool payloads are
 * untrusted input, even when the tool is your own.
 *
 * The #region markers are read by the server at startup: lesson 2.5 shows
 * these exact lines, so the lesson can never drift from the code.
 */

import { useState, type ReactNode } from "react";
import { reactSurface, type SurfaceProps } from "@haikit/react";
import type { checkpoint } from "../shared/surfaces.ts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Inline } from "./blocks/inline.tsx";
import { CourseMap } from "./surfaces/CourseMap.tsx";
import { Lesson } from "./surfaces/Lesson.tsx";
import { NextLesson } from "./surfaces/NextLesson.tsx";
import { ReferencePage } from "./surfaces/ReferencePage.tsx";
import { TutorialStep } from "./surfaces/TutorialStep.tsx";
import { Welcome } from "./surfaces/Welcome.tsx";

// #region checkpoint-component
function Checkpoint({ props, send, mode, state, selection }: SurfaceProps<typeof checkpoint>) {
  const [sending, setSending] = useState<string | null>(null);
  const live = state === "live" && mode === "elicit";
  // once answered, the option chosen; until then, the one on its way
  const picked = state === "frozen" ? selection : sending;

  const answer = async (id: string) => {
    setSending(id);
    await send("answer", id); // the only channel back
    setSending(null); // refused, the question stays live
  };

  return (
    <Card className="max-w-[760px] rounded-none bg-transparent ring-0">
      <CardHeader>
        <CardTitle>Checkpoint {props.lessonId}</CardTitle>
        <CardAction>
          <Badge variant="outline" className={cn(live && "border-hai-warn text-hai-warn")}>
            {live && <span className="size-1.5 rounded-full bg-current motion-safe:animate-waiting" />}
            {live ? "Waiting for your answer" : picked ? "Answered" : "Closed without an answer"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-2">
        <p className="mb-2 font-serif text-[19px]/[1.45]">
          <Inline text={props.question} />
        </p>
        {props.options.map((o) => (
          <Button
            key={o.id}
            variant="outline"
            disabled={!live || sending !== null}
            onClick={() => answer(o.id)}
            className={cn(
              "h-auto justify-start gap-3 px-3.5 py-2.5 text-left text-[15px]/[1.45] font-normal whitespace-normal",
              o.id === picked && "border-primary bg-hai-selected disabled:opacity-100",
            )}
          >
            <span className="font-mono font-semibold text-primary">{o.id.toUpperCase()}</span>
            <span>
              <Inline text={o.text} />
            </span>
          </Button>
        ))}
      </CardContent>
    </Card>
  );
}
// #endregion checkpoint-component

/**
 * Each surface is a React root of its own, so a provider around the rest of
 * the page never reaches it: `wrapper` puts the tooltips' around each one.
 */
function Providers({ children }: { children: ReactNode }) {
  return <TooltipProvider>{children}</TooltipProvider>;
}

export const registry = {
  welcome: reactSurface(Welcome, { wrapper: Providers }),
  course_map: reactSurface(CourseMap, { wrapper: Providers }),
  lesson: reactSurface(Lesson, { wrapper: Providers }),
  tutorial_step: reactSurface(TutorialStep, { wrapper: Providers }),
  reference_page: reactSurface(ReferencePage, { wrapper: Providers }),
  next_lesson: reactSurface(NextLesson, { wrapper: Providers }),
  checkpoint: reactSurface(Checkpoint, { wrapper: Providers }),
};
