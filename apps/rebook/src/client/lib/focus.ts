import { useLayoutEffect, useRef, type RefObject } from "react";

/** The control that has the keyboard, by its `data-key`, if it's inside `root`. */
const focusedKey = (root: HTMLElement | null) => {
  const active = document.activeElement;
  return root && active instanceof HTMLElement && root.contains(active) ? active.dataset.key : undefined;
};

/** The enabled control drawn with `key`, if there is one. */
const enabled = (root: HTMLElement, key: string) => {
  const b = root.querySelector(`button[data-key="${CSS.escape(key)}"]`);
  return b instanceof HTMLButtonElement && !b.disabled ? b : null;
};

/**
 * Keep the keyboard's place across a revision or a send. Each control is
 * drawn with a `data-key`, such as `seat:14D`. React keeps a control that
 * stays, and its focus with it; this handles one that goes or is disabled
 * while it has the focus, as a seat just taken is. The nearest enabled
 * control of its kind gets the focus instead: the next one after it, or else
 * the one before.
 *
 * While a click is on its way every control is disabled, so nothing can take
 * the focus. The key is held until a render enables one again: a refused
 * click gives the keyboard back where it was. It never takes the focus back
 * from somewhere else on the page.
 */
export function useKeepFocus(root: RefObject<HTMLElement | null>) {
  const held = useRef<string | undefined>(undefined);
  // Read as this render starts, while the DOM is still the last render's.
  const nowhere = typeof document !== "undefined" && (!document.activeElement || document.activeElement === document.body);
  const key = focusedKey(root.current) ?? (nowhere ? held.current : undefined);
  const order = key && root.current ? [...root.current.querySelectorAll<HTMLElement>("button[data-key]")].map((b) => b.dataset.key ?? "") : [];

  useLayoutEffect(() => {
    held.current = undefined;
    const el = root.current;
    if (!el || !key) return;
    const kind = key.slice(0, key.indexOf(":") + 1);
    const at = order.indexOf(key);
    const around = [...order.slice(at + 1), ...order.slice(0, Math.max(at, 0)).reverse()].filter((k) => k.startsWith(kind));
    // A disabled control can keep the focus in some browsers: what counts is whether it's enabled.
    const next = enabled(el, key) ?? around.map((k) => enabled(el, k)).find(Boolean);
    if (!next) held.current = key;
    else if (document.activeElement !== next) next.focus({ preventScroll: true });
  });
}
