import { useRef } from "react";
import type { SurfaceProps } from "@haikit/react";
import type { referencePage } from "../../shared/surfaces.ts";
import { useAnswer } from "@/lib/answer";
import { bringIntoView, scrollTranscript } from "@/lib/scroll";
import { cn } from "@/lib/utils";
import { blocks } from "../blocks/Blocks.tsx";
import { LINK, plainLink, type Linker } from "../blocks/inline.tsx";
import { BODY, Choice, Choices, Closed, PAGE, PageTitle, useShowTop, Where } from "./parts.tsx";

const section = (page: HTMLElement, anchor: string) => page.querySelector(`[data-anchor="${CSS.escape(anchor)}"]`);

/**
 * A page of the reference manual. A link to another page, or Previous, Next
 * or Contents, is the page's answer, as a tutorial page's buttons are; a link
 * to a section of this page only scrolls to it.
 */
export function ReferencePage({ props, send, mode, state, selection }: SurfaceProps<typeof referencePage>) {
  const page = useRef<HTMLElement>(null);
  const { open, picked, answer } = useAnswer({ state, mode, selection });

  // Opened at a section: bring it to the top, and mark it. Otherwise the
  // page's top: longer than the window, it would open on its last lines.
  useShowTop(page, state, (article) => {
    const at = props.anchor ? section(article, props.anchor) : null;
    scrollTranscript(article.parentElement, at ?? "top");
    if (at) bringIntoView(at, "nearest", false);
  });

  /** Its section, marked for a moment; or the page's top. The focus goes there too. */
  const toAnchor = (anchor: string | undefined) => {
    const article = page.current;
    const at = article && anchor ? section(article, anchor) : null;
    if (!article || (anchor && !at)) return;
    if (at instanceof HTMLElement) {
      at.focus({ preventScroll: true });
      bringIntoView(at, "start");
    } else {
      article.focus({ preventScroll: true });
      article.scrollIntoView({ block: "start" });
    }
  };

  /** The target and the button the page was answered with. */
  const go = (target: string) =>
    answer(target, () => {
      scrollTranscript(page.current?.parentElement, "bottom"); // follow the next page in
      return send("go", target);
    });

  /** The words of each link that leads off this page, by its target: how the answer is named. */
  const ways = new Map<string, string>();
  const link: Linker = (target, label, key, text) => {
    if (/^https:\/\//.test(target)) return plainLink(target, label, key, text);
    const [, other, anchor] = target.match(/^(?:ref:([\w-]+))?(?:#([\w-]+))?$/) ?? [];
    if (!/^tutorial:/.test(target) && (other === undefined || other === props.id)) {
      // a section of this page: the browser scrolls to it, nothing is sent
      return (
        <a
          key={key}
          className={LINK}
          href={`#${anchor ?? ""}`}
          onClick={(e) => {
            e.preventDefault();
            toAnchor(anchor);
          }}
        >
          {label}
        </a>
      );
    }
    if (!ways.has(target)) ways.set(target, text);
    // a link is a link only while the page waits; once answered, it's text
    return (
      <a
        key={key}
        data-go={target}
        href={open ? "#" : undefined}
        className={cn(open ? LINK : "cursor-default", target === picked && "bg-hai-selected")}
        onClick={(e) => {
          e.preventDefault();
          if (open) void go(target);
        }}
      >
        {label}
      </a>
    );
  };
  const body = blocks(props.blocks, link);

  const choices = [
    props.next && { value: `ref:${props.next.id}`, label: `Next: ${props.next.title}`, primary: true },
    props.prev && { value: `ref:${props.prev.id}`, label: `Previous: ${props.prev.title}` },
    props.id !== "index" && { value: "ref:index", label: "Contents" },
  ].filter((c) => !!c);

  /** How the reader's choice is named once the page is answered. */
  const named = (target: unknown) => {
    const ref = [props.next, props.prev, { id: "index", title: "the contents" }].find((r) => r && `ref:${r.id}` === target);
    if (ref) return ref.title;
    const words = typeof target === "string" ? ways.get(target) : undefined;
    return words === undefined ? null : `“${words}”`;
  };
  const to = named(picked);

  return (
    <article ref={page} tabIndex={-1} className={cn(PAGE, "outline-none")}>
      <header>
        <Where aside={`page ${props.position.index} of ${props.position.total}`}>Reference manual</Where>
        <PageTitle>{props.title}</PageTitle>
      </header>
      <div className={BODY}>{body}</div>
      <footer className="mt-[30px] border-t border-hai-line-soft pt-5">
        <Choices>
          {choices.map((c) => (
            <Choice key={c.value} primary={"primary" in c} picked={c.value === picked} disabled={!open} onClick={() => go(c.value)}>
              {c.label}
            </Choice>
          ))}
        </Choices>
        {state === "frozen" && <Closed>{to ? `You went on to ${to}.` : "Closed when you typed instead."}</Closed>}
      </footer>
    </article>
  );
}
