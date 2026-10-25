import { useState } from "react";
import type { SurfaceMode, SurfaceState } from "@haikit/client";

/**
 * A surface's question, answered by a click. `picked` is the answer on its
 * way, then, once the surface freezes, what was chosen. A refused answer
 * leaves the surface live, and the pick is let go.
 */
export function useAnswer({ state, mode, selection }: { state: SurfaceState; mode: SurfaceMode; selection?: unknown }) {
  const [sending, setSending] = useState<string | null>(null);
  const live = state === "live" && mode === "elicit";
  return {
    /** Whether the surface still waits for its answer. */
    live,
    /** Whether a click can answer it now: live, and no answer on its way. */
    open: live && sending === null,
    picked: state === "frozen" ? selection : sending,
    async answer(value: string, send: () => Promise<void>) {
      setSending(value);
      try {
        await send();
      } finally {
        setSending(null);
      }
    },
  };
}
