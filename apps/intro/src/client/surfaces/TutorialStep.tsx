import { useMemo, useRef } from "react";
import type { SurfaceProps } from "@haikit/react";
import type { tutorialStep } from "../../shared/surfaces.ts";
import { useAnswer } from "@/lib/answer";
import { scrollTranscript } from "@/lib/scroll";
import { blocks } from "../blocks/Blocks.tsx";
import { BODY, Choice, Choices, Closed, PAGE, PageTitle, useShowTop, Where } from "./parts.tsx";

/** A step is named with its number; the pages around the steps by their title alone. */
const named = (ref: { id: string; title: string }) => (/^\d+$/.test(ref.id) ? `${ref.id} ${ref.title}` : ref.title);

/** A page of a tutorial: its buttons are the question, where to go next. */
export function TutorialStep({ props, send, mode, state, selection }: SurfaceProps<typeof tutorialStep>) {
  const page = useRef<HTMLElement>(null);
  const { live, open, picked, answer } = useAnswer({ state, mode, selection });
  useShowTop(page, state);
  // drawn once: answering redraws the buttons, and the page keeps the
  // reader's place and any fold they opened
  const body = useMemo(() => blocks(props.blocks), [props.blocks]);

  const choices = [
    props.next && { value: props.next.id, label: `Next: ${named(props.next)}`, primary: true },
    props.prev && { value: props.prev.id, label: `Previous: ${named(props.prev)}` },
    { value: "course-map", label: "Course map" },
  ].filter((c) => !!c);
  const go = (value: string) =>
    answer(value, () => {
      scrollTranscript(page.current?.parentElement, "bottom"); // follow the next page in
      return send("go", value); // the buttons are the question
    });
  const to = [props.next, props.prev].find((p) => p?.id === picked);

  return (
    <article ref={page} className={PAGE}>
      <header>
        <Where aside={`page ${props.position.index} of ${props.position.total}`}>Tutorial: {props.tutorial}</Where>
        <PageTitle n={/^\d+$/.test(props.id) ? props.id : undefined}>{props.title}</PageTitle>
      </header>
      <div className={BODY}>{body}</div>
      <footer className="mt-[30px] border-t border-hai-line-soft pt-5">
        <Choices>
          {choices.map((c) => (
            <Choice key={c.value} primary={c.primary} picked={c.value === picked} disabled={!open} onClick={() => go(c.value)}>
              {c.label}
            </Choice>
          ))}
        </Choices>
        {!live && state === "frozen" && (
          <Closed>
            {picked === "course-map" ? "You opened the course map." : to ? `You went on to ${named(to)}.` : "Closed when you typed instead."}
          </Closed>
        )}
      </footer>
    </article>
  );
}
