/**
 * hello's two surfaces as React components. Compare examples/hello/src/client/
 * components.js: same contract, same Tailwind classes.
 *
 * `SurfaceProps<typeof greetingPicker>` types `props` from the surface's schema
 * and `send` against the actions it declares, so changing either in
 * src/shared/surfaces.ts stops this file compiling. It is a type-only import:
 * zod and the contract stay out of the browser bundle.
 */

import { useState } from "react";
import { reactSurface, type SurfaceProps } from "@haikit/react";
import type { greetingCard, greetingPicker } from "../shared/surfaces.ts";

// HaiKIT's tokens as Tailwind colours, from @haikit/client/tailwind.css
const CHIP = "cursor-pointer rounded-full border px-2.5 py-0.75 font-hai-mono text-[11px]";
const CHIP_ON = `${CHIP} border-hai-accent bg-hai-accent text-hai-on-accent`;
const CHIP_OFF = `${CHIP} border-hai-line text-hai-dim hover:border-hai-accent hover:text-hai-fg`;
const ROW = "grid w-full grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] items-baseline gap-3 border-b border-hai-line-soft px-3 py-1.75 text-left";

function GreetingPicker({ props, send, mode, state, selection }: SurfaceProps<typeof greetingPicker>) {
  // Local state. It is not in the contract, so it has no way to reach the
  // server. And the transcript mounts a surface once, so it survives the
  // conversation streaming on around it.
  const [script, setScript] = useState<string | null>(null);

  const scripts = [...new Set(props.greetings.map((g) => g.script))].sort();
  const rows = props.greetings.filter((g) => !script || g.script === script);
  const live = state === "live" && mode === "elicit";

  return (
    <>
      <div className="flex flex-wrap gap-1.5 px-3 pt-2.25 pb-1">
        {[null, ...scripts].map((sc) => (
          <button
            key={sc ?? "all"}
            type="button"
            className={script === sc ? CHIP_ON : CHIP_OFF}
            aria-pressed={script === sc}
            onClick={() => setScript(sc)}
          >
            {sc ?? "all"}
          </button>
        ))}
      </div>
      <div className="pt-1 pb-2">
        {rows.map((g) => {
          const row = (
            <>
              {/* text, never HTML: tool payloads are untrusted input, and React escapes it */}
              <span className="text-[15px]" dir={g.rtl ? "rtl" : undefined}>
                {g.text}
              </span>
              <span className="font-hai-mono text-xs text-hai-dim">{g.language}</span>
            </>
          );
          // a row that can be chosen is a button, so a keyboard can choose it too
          return live ? (
            <button
              key={g.code}
              type="button"
              className={`${ROW} cursor-pointer hover:bg-hai-hover focus-visible:bg-hai-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-hai-fg`}
              onClick={() => void send("choose", g.code)}
            >
              {row}
            </button>
          ) : (
            <div key={g.code} className={g.code === selection ? `${ROW} bg-hai-selected` : ROW}>
              {row}
            </div>
          );
        })}
      </div>
    </>
  );
}

function GreetingCard({ props: { greeting: g }, send }: SurfaceProps<typeof greetingCard>) {
  const [copied, setCopied] = useState(false);

  // A display surface never parks the turn, so there is nothing to resolve.
  // `inform` adds a line to the conversation after the fact.
  const copy = async () => {
    await navigator.clipboard?.writeText(g.text).catch(() => {});
    setCopied(true);
    void send("copy", { code: g.code });
  };

  return (
    <div className="flex flex-col items-start gap-2 px-3.5 py-4">
      <div className="text-[28px] leading-tight" dir={g.rtl ? "rtl" : undefined}>
        {g.text}
      </div>
      <div className="font-hai-mono text-xs text-hai-dim">
        {g.language} · {g.script} · {g.speakersM}M speakers
      </div>
      <button type="button" className={CHIP_OFF} onClick={copy}>
        {copied ? "copied" : "copy"}
      </button>
    </div>
  );
}

// Keys must match each surface's `name`. The registry is an allowlist: a
// component it doesn't name renders an error card, never an improvised UI.
export const registry = {
  greeting_picker: reactSurface(GreetingPicker),
  greeting_card: reactSurface(GreetingCard),
};
