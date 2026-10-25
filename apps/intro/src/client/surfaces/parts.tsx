/** Pieces the course's surfaces share: their answers, their headings, their first scroll. */

import { useEffect, useState, type ComponentProps, type ReactNode, type RefObject } from "react";
import type { SurfaceState } from "@haikit/client";
import { Button } from "@/components/ui/button";
import { scrollTranscript } from "@/lib/scroll";
import { cn } from "@/lib/utils";

/**
 * One of a surface's answers: a button, the first of them filled. The one
 * picked stays marked, and stays at full strength once the rest are disabled.
 */
export function Choice({
  primary,
  picked,
  className,
  ...props
}: ComponentProps<typeof Button> & { primary?: boolean; picked?: boolean }) {
  return (
    <Button
      size="lg"
      variant={primary ? "default" : "outline"}
      data-picked={picked || undefined}
      className={cn(
        "h-auto min-h-9 px-4 py-2 text-[13.5px] whitespace-normal",
        picked && "ring-2 ring-hai-accent ring-offset-2 ring-offset-background disabled:opacity-100",
        className,
      )}
      {...props}
    />
  );
}

/** A row of answers. */
export function Choices({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap gap-2.5", className)}>{children}</div>;
}

/** What became of a surface's question, once it's answered or closed. */
export function Closed({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-[13px] text-muted-foreground">{children}</p>;
}

/** Where a page sits: its part or its book on the left, its length or place on the right. */
export function Where({ children, aside }: { children: ReactNode; aside: ReactNode }) {
  return (
    <p className="mb-2.5 flex flex-wrap justify-between gap-x-4 gap-y-1 font-sans text-[13px] text-muted-foreground">
      <span>{children}</span>
      <span>{aside}</span>
    </p>
  );
}

/** A page's title, with its number in the accent when it has one. */
export function PageTitle({ n, children }: { n?: string | undefined; children: ReactNode }) {
  return (
    <h2 className="flex items-baseline gap-[0.45em] font-heading text-[clamp(24px,3.4vw,32px)]/[1.12] font-bold tracking-[-0.02em] text-balance">
      {n && <span className="text-primary tabular-nums">{n}</span>}
      <span>{children}</span>
    </h2>
  );
}

/** A page's own column: wider than prose, for code, tables and side-by-side panels. */
export const PAGE = "max-w-[1200px] px-7 pt-[26px] pb-[22px] max-sm:px-4 max-sm:pt-5 max-sm:pb-[18px]";
/** A page's text: serif, at a reading measure the blocks set themselves. */
export const BODY = "mt-5 font-serif text-[17px]/[1.65] max-sm:text-[16.5px]";

/**
 * Once, when a surface is mounted live: longer than the window, it would open
 * on its last lines, since the transcript follows the newest content. Show its
 * top instead, or what `then` picks, once the transcript has placed it.
 */
export function useShowTop(ref: RefObject<HTMLElement | null>, state: SurfaceState, then?: (page: HTMLElement) => void) {
  const [mounted] = useState(state);
  useEffect(() => {
    if (mounted !== "live") return;
    const frame = requestAnimationFrame(() => {
      if (!ref.current) return;
      if (then) then(ref.current);
      else scrollTranscript(ref.current.parentElement, "top");
    });
    return () => cancelAnimationFrame(frame);
    // only as it mounts
  }, []);
}
