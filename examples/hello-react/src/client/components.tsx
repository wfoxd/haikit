/**
 * hello's two surfaces as React components. Compare examples/hello/public/
 * components.js: same contract, same class names, same styles.
 *
 * `SurfaceProps<typeof greetingPicker>` types `props` from the surface's schema
 * and `send` against the actions it declares, so changing either in
 * src/shared/surfaces.ts stops this file compiling. It is a type-only import:
 * zod and the contract stay out of the browser bundle.
 */

import { useState } from "react";
import { reactSurface, type SurfaceProps } from "@haikit/react";
import type { greetingCard, greetingPicker } from "../shared/surfaces.ts";

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
      <div className="chips">
        {[null, ...scripts].map((sc) => (
          <button
            key={sc ?? "all"}
            type="button"
            className={script === sc ? "chip on" : "chip"}
            aria-pressed={script === sc}
            onClick={() => setScript(sc)}
          >
            {sc ?? "all"}
          </button>
        ))}
      </div>
      <div className="rows">
        {rows.map((g) => {
          const row = (
            <>
              {/* text, never HTML: tool payloads are untrusted input, and React escapes it */}
              <span className="greeting" dir={g.rtl ? "rtl" : undefined}>
                {g.text}
              </span>
              <span className="lang">{g.language}</span>
            </>
          );
          // a row that can be chosen is a button, so a keyboard can choose it too
          return live ? (
            <button key={g.code} type="button" className="row selectable" onClick={() => void send("choose", g.code)}>
              {row}
            </button>
          ) : (
            <div key={g.code} className={g.code === selection ? "row picked" : "row"}>
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
    <div className="card">
      <div className="card-text" dir={g.rtl ? "rtl" : undefined}>
        {g.text}
      </div>
      <div className="card-meta">
        {g.language} · {g.script} · {g.speakersM}M speakers
      </div>
      <button className="chip" onClick={copy}>
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
