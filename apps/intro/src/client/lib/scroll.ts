/** The mark a line or a section gets when a link brings it into view. */
const FLASH = "motion-safe:animate-flash";

/**
 * Bring an element into view and mark it for a moment.
 * @param block where it lands: "nearest" moves as little as it can
 */
export function bringIntoView(target: Element | null, block: ScrollLogicalPosition = "nearest", smooth = true) {
  if (!target) return;
  const still = !smooth || matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ block, behavior: still ? "auto" : "smooth" });
  target.classList.remove(FLASH);
  void target.getBoundingClientRect(); // restart the animation
  target.classList.add(FLASH);
}

/**
 * Bring a note, or the line it explains, into view and mark it for a moment.
 * The focus goes with it, so the keyboard carries on from there.
 */
export function reveal(id: string) {
  const target = document.getElementById(id);
  target?.focus({ preventScroll: true });
  bringIntoView(target);
}

/**
 * Scroll the transcript that holds a surface, as its reader would.
 *
 * The default UI follows the newest content while the reader is at the
 * bottom, and keeps their place once they scroll up. It tells which from the
 * transcript's scroll events, so one goes with the move. Outside a transcript
 * this does nothing.
 * @param surface the element a surface mounted into
 * @param where its top (with the tool row above it), the end, or an element
 *   in it, brought to the top
 */
export function scrollTranscript(surface: Element | null | undefined, where: "top" | "bottom" | Element) {
  const transcript = surface?.closest(".hai-transcript");
  if (!surface || !(transcript instanceof HTMLElement)) return;
  if (where === "bottom") {
    transcript.scrollTop = transcript.scrollHeight;
  } else if (where instanceof Element) {
    transcript.scrollTop += where.getBoundingClientRect().top - transcript.getBoundingClientRect().top - 14;
  } else {
    const first = surface.previousElementSibling ?? surface;
    const above = first.getBoundingClientRect().top - transcript.getBoundingClientRect().top - 16;
    if (above >= 0) return; // its top is already in view: keep following
    transcript.scrollTop += above;
  }
  transcript.dispatchEvent(new Event("scroll"));
}
