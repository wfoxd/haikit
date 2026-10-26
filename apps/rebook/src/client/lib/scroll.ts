import { useEffect, useState, type RefObject } from "react";

/**
 * Scroll the transcript so a new question opens at its top, with the tool row
 * above it: above the window, it would show its last lines, and below, the
 * traveller would miss it. The default UI follows the newest content to the
 * bottom, and tells the reader's scrolling from its own by the scroll events,
 * so one goes with the move. Outside a transcript, or with its top already in
 * the upper half of the window, this does nothing.
 * @param surface the element a surface mounted into
 */
export function showTop(surface: HTMLElement) {
  const transcript = surface.closest(".hai-transcript");
  if (!(transcript instanceof HTMLElement)) return;
  const first = surface.previousElementSibling ?? surface;
  const offset = first.getBoundingClientRect().top - transcript.getBoundingClientRect().top - 16;
  if (offset >= 0 && offset < transcript.clientHeight / 2) return;
  transcript.scrollTop += offset;
  transcript.dispatchEvent(new Event("scroll"));
}

/** Once, a frame after a surface is mounted live, once the transcript has placed it: `showTop`. */
export function useShowTop(ref: RefObject<HTMLElement | null>, state: string) {
  const [mounted] = useState(state);
  useEffect(() => {
    if (mounted !== "live") return;
    const frame = requestAnimationFrame(() => {
      const surface = ref.current?.parentElement;
      if (surface) showTop(surface);
    });
    return () => cancelAnimationFrame(frame);
    // only as it mounts
  }, []);
}
