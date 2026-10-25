import { useRef } from "react";
import type { SurfaceProps } from "@haikit/react";
import type { nextLesson } from "../../shared/surfaces.ts";
import { useAnswer } from "@/lib/answer";
import { scrollTranscript } from "@/lib/scroll";
import { Choice, Choices, Closed } from "./parts.tsx";

/** Up next: the button is the question, and the next lesson waits for its click. */
export function NextLesson({ props: { next }, send, mode, state, selection }: SurfaceProps<typeof nextLesson>) {
  const root = useRef<HTMLDivElement>(null);
  const { live, open, picked, answer } = useAnswer({ state, mode, selection });
  const choices = [
    { value: "next-lesson", label: `Continue to lesson ${next.id}`, primary: true },
    { value: "course-map", label: "See the course map" },
  ] as const;
  const go = (value: (typeof choices)[number]["value"]) =>
    answer(value, () => {
      scrollTranscript(root.current?.parentElement, "bottom"); // follow the lesson in as it streams
      return send("go", value);
    });

  return (
    <div ref={root} className="max-w-[640px] px-[22px] py-[18px]">
      <p className="text-[12.5px] text-muted-foreground">Up next, {next.minutes} min</p>
      <h3 className="mt-1 flex items-baseline gap-[0.45em] font-heading text-lg/[1.3] font-semibold tracking-[-0.01em]">
        <span className="text-primary tabular-nums">{next.id}</span>
        <span>{next.title}</span>
      </h3>
      <p className="mt-1.5 max-w-[60ch] font-serif text-[15px]/[1.5] text-muted-foreground">{next.summary}</p>
      <Choices className="mt-4">
        {choices.map((c) => (
          <Choice key={c.value} primary={"primary" in c} picked={c.value === picked} disabled={!open} onClick={() => go(c.value)}>
            {c.label}
          </Choice>
        ))}
      </Choices>
      {!live && state === "frozen" && (
        <Closed>
          {picked === "next-lesson"
            ? `You continued to lesson ${next.id}.`
            : picked === "course-map"
              ? "You opened the course map."
              : "Closed when you typed instead of choosing."}
        </Closed>
      )}
    </div>
  );
}
