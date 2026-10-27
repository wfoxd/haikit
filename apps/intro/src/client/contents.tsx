/**
 * The contents rail: the whole introduction beside the chat. The welcome
 * screen and the course map, every lesson by part, every page of each
 * tutorial, the reference manual's pages and the demos, with the page on
 * screen marked and a tick on each page the conversation has shown.
 *
 * mountChat draws the shell and has no option for a sidebar, so main.tsx
 * gives the rail a slot at the start of the shell's main grid, and its button
 * a place at the start of the header. On a wide screen the rail is a column
 * beside the chat, open unless the reader closed it, which this browser
 * remembers. On a narrower one it's a sheet that slides over the chat from
 * the left; a choice, Escape or a click outside closes it.
 *
 * A choice is a chat message, such as "Open lesson 1.3": the rail isn't a
 * surface, so the only way it can reach the server is the way typing does,
 * and the guide answers by showing what was asked for. A question waiting on
 * screen is closed by it, as typing would. A demo is the exception: it's a
 * site of its own, so its item is a link that opens it in a new tab, and
 * nothing reaches the conversation.
 *
 * Where the reader is comes from the conversation itself, not from what they
 * clicked: the last page it shows is the one marked, and every page it has
 * shown has its tick, however it was opened. A new chat starts with none.
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Chat, ChatState } from "@haikit/client";
import { CaretRightIcon, CheckIcon, HouseIcon, MapTrifoldIcon, SidebarSimpleIcon, XIcon } from "@phosphor-icons/react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type Ref = { id: string; title: string };
type Page = { id: string; label: string; title: string };
type Demo = { title: string; detail: string; url: string };
export type MenuData = {
  lessons: { part: number; title: string; lessons: Ref[] }[];
  tutorials: { title: string; pages: Page[] }[];
  reference?: { title: string; pages: Ref[] };
  demos?: Demo[];
};

/**
 * A page of the introduction, by the surface that shows it and its id:
 * "lesson:1.3", "tutorial_step:3-04", "reference_page:limits". The welcome
 * screen and the course map have no id.
 */
type Key = string;
type Item = { key: Key; n?: ReactNode; label: string; message: string };
type Group = { id: string; title: string; items: Item[] };
type Section = { heading: string; groups: Group[] };

/** Beside the chat from this width; globals.css lays out the column at the same one. */
const WIDE = "(min-width: 1100px)";
/** Whether the reader closed the rail, in this browser. */
const REMEMBER = "intro:contents";
const DOCKED = "intro-contents";

/** A tutorial page's number, without a later tutorial's prefix; the pages around the steps have none. */
const numberOf = (id: string) => id.match(/^(?:\d+-)?(\d+)$/)?.[1];

const HOME: Item[] = [
  { key: "welcome", n: <HouseIcon className="size-4" />, label: "Welcome", message: "Show the welcome screen" },
  { key: "course_map", n: <MapTrifoldIcon className="size-4" />, label: "Course map", message: "Show the course map" },
];

const sectionsOf = (data: MenuData): Section[] => [
  {
    heading: "Course",
    groups: data.lessons.map((p) => ({
      id: `part-${p.part}`,
      title: `Part ${p.part}: ${p.title}`,
      items: p.lessons.map((l) => ({ key: `lesson:${l.id}`, n: l.id, label: l.title, message: `Open lesson ${l.id}` })),
    })),
  },
  {
    heading: "Tutorials",
    groups: data.tutorials.map((t, i) => ({
      id: `tutorial-${i + 1}`,
      title: t.title,
      items: t.pages.map((p) => {
        const n = numberOf(p.id);
        return n
          ? { key: `tutorial_step:${p.id}`, n, label: p.title, message: `Open tutorial step ${p.id}` }
          : // the introduction by its label, as its title is a whole sentence
            { key: `tutorial_step:${p.id}`, label: /intro$/.test(p.id) ? p.label : p.title, message: `Open tutorial page ${p.id}` };
      }),
    })),
  },
  // a server from before the reference was built in sends none
  ...(data.reference
    ? [
        {
          heading: "Reference",
          groups: [
            {
              id: "reference",
              title: data.reference.title,
              items: data.reference.pages.map((p) => ({ key: `reference_page:${p.id}`, label: p.title, message: `Open reference page ${p.id}` })),
            },
          ],
        },
      ]
    : []),
];

const PAGES = new Set(["welcome", "course_map", "lesson", "tutorial_step", "reference_page"]);

/** The pages the conversation has shown, in the order it showed them: the last is on screen. */
function shownIn(state: ChatState): Key[] {
  const keys: Key[] = [];
  for (const block of state.blocks) {
    if (block.kind !== "ui") continue;
    const surface = state.surfaces.get(block.handle);
    // its props arrive after its block does
    if (!surface?.props || !PAGES.has(surface.component)) continue;
    const id = (surface.props as { id?: unknown }).id;
    keys.push(typeof id === "string" ? `${surface.component}:${id}` : surface.component);
  }
  return keys;
}

/** Where the reader is: the page on screen, and every page shown so far. */
function useWhere(chat: Chat) {
  const [shown, setShown] = useState(() => shownIn(chat.state));
  useEffect(() => {
    let last = "";
    const update = (state: ChatState) => {
      const next = shownIn(state);
      // most events are text arriving: only a new page redraws the rail
      const id = next.join("\n");
      if (id !== last) {
        last = id;
        setShown(next);
      }
    };
    const off = chat.subscribe(update);
    // pages may have come since the first render: subscribers hear only what comes next
    update(chat.state);
    return off;
  }, [chat]);
  return useMemo(() => ({ current: shown.at(-1) ?? null, opened: new Set(shown) }), [shown]);
}

function useMedia(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const list = matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => matchMedia(query).matches,
  );
}

const readClosed = () => {
  try {
    return localStorage.getItem(REMEMBER) === "closed";
  } catch {
    return false;
  }
};

/**
 * The rail, and its button in the header.
 * @param main the default UI's main grid, which gives the rail its column while it's open beside the chat
 * @param button where the header keeps the rail's button
 */
export function Contents({ chat, data, main, button }: { chat: Chat; data: MenuData; main: HTMLElement; button: HTMLElement }) {
  const sections = useMemo(() => sectionsOf(data), [data]);
  const { current, opened } = useWhere(chat);
  const wide = useMedia(WIDE);
  const [closed, setClosed] = useState(readClosed);
  const [sheet, setSheet] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);

  const docked = wide && !closed;
  const open = wide ? docked : sheet;
  useEffect(() => {
    main.classList.toggle("contents-open", docked);
  }, [main, docked]);
  // a sheet left open as the screen widens gives way to the column
  useEffect(() => {
    if (wide) setSheet(false);
  }, [wide]);

  const dock = (next: boolean) => {
    setClosed(!next);
    try {
      localStorage.setItem(REMEMBER, next ? "open" : "closed");
    } catch {}
  };

  // The group that holds the page on screen opens with it, so the mark is in
  // view. The reader can close it again: it opens again for the next page.
  const groupOf = useMemo(() => new Map(sections.flatMap((s) => s.groups.flatMap((g) => g.items.map((i) => [i.key, g.id] as const)))), [sections]);
  const [expanded, setExpanded] = useState(() => new Set(current && groupOf.has(current) ? [groupOf.get(current)!] : []));
  const [seen, setSeen] = useState(current);
  if (current !== seen) {
    setSeen(current);
    const group = current && groupOf.get(current);
    if (group && !expanded.has(group)) setExpanded(new Set(expanded).add(group));
  }
  const flip = (group: string) =>
    setExpanded((was) => {
      const next = new Set(was);
      if (!next.delete(group)) next.add(group);
      return next;
    });

  const choose = (message: string) => {
    // follow the reply in, wherever the reader had scrolled to
    const transcript = document.querySelector(".hai-transcript");
    if (transcript instanceof HTMLElement) {
      transcript.scrollTop = transcript.scrollHeight;
      transcript.dispatchEvent(new Event("scroll"));
    }
    setSheet(false);
    void chat.send(message);
  };

  const total = groupOf.size;
  const read = [...opened].filter((key) => groupOf.has(key)).length;
  const progress = read ? `${read} of ${total} pages opened` : `${total} pages`;
  const list = (
    <List
      sections={sections}
      demos={data.demos ?? []}
      current={current}
      opened={opened}
      expanded={expanded}
      flip={flip}
      choose={choose}
    />
  );

  return (
    <>
      {createPortal(
        <button
          ref={toggle}
          type="button"
          aria-expanded={open}
          aria-controls={wide ? DOCKED : undefined}
          title={open ? "Close the contents" : "Open the contents"}
          onClick={() => (wide ? dock(!docked) : setSheet(!sheet))}
          className="-ml-1.5 inline-flex h-[34px] flex-none cursor-pointer items-center gap-[7px] border-2 border-transparent px-2 text-[13px] font-semibold text-hai-dim hover:border-hai-line hover:bg-hai-hover hover:text-hai-fg aria-expanded:text-hai-fg focus-visible:outline-2 focus-visible:outline-hai-accent"
        >
          <SidebarSimpleIcon className="size-[18px]" />
          <span className="max-[900px]:sr-only">Contents</span>
        </button>,
        button,
      )}
      {docked && (
        <nav id={DOCKED} aria-label="Contents" className="flex min-h-0 w-full flex-col border-r-3 border-hai-line bg-hai-panel-2 font-sans">
          <div className="flex flex-none items-center gap-2 border-b-3 border-hai-line py-2.5 pr-2.5 pl-4">
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-[13px] font-bold">Contents</span>
              <span className="text-xs text-hai-dim">{progress}</span>
            </div>
            <button
              type="button"
              aria-label="Close the contents"
              onClick={() => {
                dock(false);
                toggle.current?.focus();
              }}
              className="grid size-8 cursor-pointer place-items-center border-2 border-transparent text-hai-dim hover:border-hai-line hover:bg-hai-hover hover:text-hai-fg focus-visible:outline-2 focus-visible:outline-hai-accent"
            >
              <XIcon className="size-4" />
            </button>
          </div>
          {list}
        </nav>
      )}
      {!wide && (
        <Sheet open={sheet} onOpenChange={setSheet}>
          <SheetContent
            side="left"
            // Radix gives the focus back to its own trigger, and the header's button isn't one
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              toggle.current?.focus();
            }}
            className="gap-0 data-[side=left]:w-[min(320px,calc(100vw-48px))] border-r-3 border-hai-line bg-hai-panel-2 p-0 font-sans">
            <SheetHeader className="flex-none border-b-3 border-hai-line py-2.5 pr-12 pl-4">
              <SheetTitle className="text-[13px] font-bold">Contents</SheetTitle>
              <SheetDescription className="text-xs text-hai-dim">{progress}</SheetDescription>
            </SheetHeader>
            <nav aria-label="Contents" className="flex min-h-0 flex-1 flex-col">
              {list}
            </nav>
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}

const ROW = "grid w-full cursor-pointer items-baseline gap-x-1.5 py-[5px] pr-3 text-left text-[13.5px]/[1.35] hover:bg-hai-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-hai-accent";

/** Every lesson and page, by section and group, then the demos. */
function List({
  sections,
  demos,
  current,
  opened,
  expanded,
  flip,
  choose,
}: {
  sections: Section[];
  demos: Demo[];
  current: Key | null;
  opened: Set<Key>;
  expanded: Set<string>;
  flip: (group: string) => void;
  choose: (message: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  // the page on screen, brought into view as it changes and when the sheet opens
  useEffect(() => {
    scroller.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest" });
  }, [current]);

  /**
   * A page: its number, its title, and its tick once shown. In a group with
   * numbers, a page without one keeps the column, so the titles line up.
   */
  const row = (item: Item, inset: boolean, numbered: boolean) => {
    const here = item.key === current;
    const ticked = opened.has(item.key) && item.key !== "welcome" && item.key !== "course_map";
    return (
      <li key={item.key}>
        <button
          type="button"
          aria-current={here ? "page" : undefined}
          onClick={() => choose(item.message)}
          className={cn(
            ROW,
            numbered ? "grid-cols-[2.4em_minmax(0,1fr)_auto]" : "grid-cols-[minmax(0,1fr)_auto]",
            inset ? "pl-[30px]" : "pl-3",
            here && "bg-hai-selected font-semibold shadow-[inset_3px_0_0_var(--hai-accent)]",
          )}
        >
          {numbered && <span className="self-center font-mono text-xs font-semibold text-hai-accent tabular-nums [&>svg]:text-hai-dim">{item.n}</span>}
          <span className="text-pretty">{item.label}</span>
          <span className="self-center text-hai-dim">
            {ticked && (
              <>
                <CheckIcon weight="bold" className="size-3" aria-hidden />
                <span className="sr-only">, opened</span>
              </>
            )}
          </span>
        </button>
      </li>
    );
  };

  const heading = (text: string) => <h2 className="px-3 pt-4 pb-1 font-mono text-[11.5px] text-hai-dim">{text}</h2>;

  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain pt-2 pb-4">
      <ul>{HOME.map((item) => row(item, false, true))}</ul>
      {sections.map((section) => (
        <section key={section.heading}>
          {heading(section.heading)}
          <ul>
            {section.groups.map((group) => {
              const open = expanded.has(group.id);
              const read = group.items.filter((i) => opened.has(i.key)).length;
              const holds = !open && group.items.some((i) => i.key === current);
              return (
                <li key={group.id}>
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={`contents-${group.id}`}
                    onClick={() => flip(group.id)}
                    className={cn(
                      "flex w-full cursor-pointer items-start gap-1.5 py-[5px] pr-3 pl-3 text-left text-[13.5px]/[1.35] font-semibold hover:bg-hai-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-hai-accent",
                      // closed on the page on screen, the group carries its mark
                      holds && "bg-hai-selected shadow-[inset_3px_0_0_var(--hai-accent)]",
                    )}
                  >
                    <CaretRightIcon
                      aria-hidden
                      className={cn("mt-[3px] size-3 flex-none text-hai-dim transition-transform motion-reduce:transition-none", open && "rotate-90")}
                    />
                    <span className="min-w-0 flex-1 text-pretty">{group.title}</span>
                    <span aria-hidden className="mt-px font-mono text-[11.5px] font-normal whitespace-nowrap text-hai-dim tabular-nums">
                      {read ? `${read}/${group.items.length}` : group.items.length}
                    </span>
                    <span className="sr-only">
                      , {read ? `${read} of ${group.items.length} opened` : `${group.items.length} pages`}
                      {holds && ", the page on screen among them"}
                    </span>
                  </button>
                  {open && (
                    <ol id={`contents-${group.id}`} className="pb-1">
                      {group.items.map((item) => row(item, true, group.items.some((i) => i.n !== undefined)))}
                    </ol>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {/* a server from before the demos sends none */}
      {demos.length > 0 && (
        <section>
          {heading("Demos")}
          <ul>
            {demos.map(
              (d) =>
                // A site of its own: a plain link, in a new tab. Only an https URL becomes one.
                /^https:\/\//.test(d.url) && (
                  <li key={d.url}>
                    <a
                      href={d.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${d.title}: ${d.detail} (opens in a new tab)`}
                      className="grid gap-0.5 py-[5px] pr-3 pl-3 text-[13.5px]/[1.35] hover:bg-hai-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-hai-accent"
                    >
                      <span className="font-semibold">
                        {d.title} <span className="font-normal text-hai-dim">↗</span>
                      </span>
                      <span className="line-clamp-2 text-[12.5px] text-hai-dim">{d.detail}</span>
                    </a>
                  </li>
                ),
            )}
          </ul>
        </section>
      )}
    </div>
  );
}
