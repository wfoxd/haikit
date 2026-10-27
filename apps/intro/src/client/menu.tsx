/**
 * The menu bar under the header: Home, Tutorial, Lesson, Reference and Demo.
 *
 * mountChat draws the header and has no option for a menu, so main.tsx adds a
 * bar of its own just beneath it. A choice is a chat message, such as "Open
 * lesson 1.3": the header isn't a surface, so the only way it can reach the
 * server is the way typing does, and the guide answers by showing what was
 * asked for. A question waiting on screen is closed by it, as typing would.
 *
 * A demo is the exception: it's a site of its own, so its item is a link that
 * opens it in a new tab, and nothing reaches the conversation.
 *
 * Each menu is a shadcn/ui dropdown: the arrow keys move through it, Escape
 * closes it and returns to its button, and a click elsewhere closes it.
 */

import type { ComponentType } from "react";
import type { Chat } from "@haikit/client";
import { BookOpenIcon, CaretDownIcon, CodeIcon, FileTextIcon, HouseIcon, PlayCircleIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Ref = { id: string; title: string };
type Demo = { title: string; detail: string; url: string };
export type MenuData = {
  lessons: { part: number; title: string; lessons: Ref[] }[];
  tutorials: { title: string; steps: Ref[] }[];
  reference?: { title: string; pages: Ref[] };
  demos?: Demo[];
};
type Item = { n?: string; label: string; message: string } | { label: string; detail: string; href: string };
type Group = { heading?: string; items: Item[] };
type Section = { label: string; icon: ComponentType<{ className?: string }>; groups: Group[] };

const sectionsOf = (data: MenuData): Section[] => [
  { label: "Home", icon: HouseIcon, groups: [{ items: [{ label: "Welcome", message: "Show the welcome screen" }] }] },
  {
    label: "Tutorial",
    icon: CodeIcon,
    // one group per tutorial; a step's number drops a later tutorial's prefix
    groups: data.tutorials.map((t) => ({
      heading: t.title,
      items: t.steps.map((s) => ({ n: s.id.replace(/^\d+-/, ""), label: s.title, message: `Open tutorial step ${s.id}` })),
    })),
  },
  {
    label: "Lesson",
    icon: BookOpenIcon,
    groups: data.lessons.map((p) => ({
      heading: `Part ${p.part}: ${p.title}`,
      items: p.lessons.map((l) => ({ n: l.id, label: l.title, message: `Open lesson ${l.id}` })),
    })),
  },
  // a server from before the reference was built in sends none
  ...(data.reference
    ? [
        {
          label: "Reference",
          icon: FileTextIcon,
          groups: [{ heading: data.reference.title, items: data.reference.pages.map((p) => ({ label: p.title, message: `Open reference page ${p.id}` })) }],
        },
      ]
    : []),
  // a server from before the demos sends none
  ...(data.demos?.length
    ? [
        {
          label: "Demo",
          icon: PlayCircleIcon,
          groups: [{ heading: "Apps built with HaiKIT", items: data.demos.map((d) => ({ label: d.title, detail: d.detail, href: d.url })) }],
        },
      ]
    : []),
];

const ITEM = "grid w-full cursor-pointer items-baseline gap-1 px-2 py-[7px] font-sans text-sm/[1.35]";

export function Menu({ chat, data }: { chat: Chat; data: MenuData }) {
  const choose = (message: string) => {
    // follow the reply in, wherever the reader had scrolled to
    const transcript = document.querySelector(".hai-transcript");
    if (transcript instanceof HTMLElement) {
      transcript.scrollTop = transcript.scrollHeight;
      transcript.dispatchEvent(new Event("scroll"));
    }
    void chat.send(message);
  };

  return sectionsOf(data).map((section) => (
    // not modal, so another menu's button opens that menu at the first click
    <DropdownMenu key={section.label} modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="group h-8 gap-[7px] px-2.5 font-heading text-[13.5px] font-semibold max-[480px]:gap-[5px] max-[480px]:px-[7px]">
          <section.icon className="size-4 text-muted-foreground transition-colors group-hover:text-hai-accent group-aria-expanded:text-hai-accent motion-reduce:transition-none max-[480px]:hidden" />
          {section.label}
          <CaretDownIcon className="-ml-0.5 size-3 opacity-55 transition-transform group-aria-expanded:rotate-180 motion-reduce:transition-none max-[480px]:hidden" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        collisionPadding={12}
        className="max-h-[min(var(--radix-dropdown-menu-content-available-height),calc(100vh-110px))] w-[min(380px,calc(100vw-24px))] min-w-[280px] p-1.5 max-[640px]:min-w-0"
      >
        {section.groups.map((group, g) => (
          <DropdownMenuGroup key={g}>
            {g > 0 && <DropdownMenuSeparator />}
            {group.heading && <DropdownMenuLabel className="px-2 pt-2 pb-[3px] font-heading text-xs font-semibold text-muted-foreground">{group.heading}</DropdownMenuLabel>}
            {group.items.map((item) =>
              "href" in item ? (
                // A site of its own: a plain link, in a new tab. Only an https URL becomes one.
                /^https:\/\//.test(item.href) && (
                  <DropdownMenuItem key={item.href} asChild className={ITEM}>
                    <a href={item.href} target="_blank" rel="noopener noreferrer" aria-label={`${item.label}: ${item.detail} (opens in a new tab)`}>
                      <span className="font-semibold">
                        {item.label} <span className="font-normal text-muted-foreground">↗</span>
                      </span>
                      <span className="text-[13px] text-muted-foreground">{item.detail}</span>
                    </a>
                  </DropdownMenuItem>
                )
              ) : (
                <DropdownMenuItem
                  key={item.message}
                  onSelect={() => choose(item.message)}
                  className={item.n ? `${ITEM} grid-cols-[2.6em_minmax(0,1fr)]` : ITEM}
                >
                  {item.n && <span className="font-mono text-xs font-semibold text-hai-accent tabular-nums">{item.n}</span>}
                  <span>{item.label}</span>
                </DropdownMenuItem>
              ),
            )}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  ));
}
