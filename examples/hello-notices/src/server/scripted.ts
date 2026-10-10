/**
 * A scripted ModelAdapter so the app runs with no API key.
 *
 * It lives in the APP, not the framework — which is the point of the adapter
 * seam. `ModelAdapter` is one method; anything that satisfies it plugs in, and
 * the runtime cannot tell the difference.
 *
 *   HAI_SCRIPTED=1 npm start
 *
 * Note what this file does NOT do: it never reads GREETINGS. It only ever sees
 * what a real model would see — the digest and the tool results. Every claim it
 * makes is extracted from those strings, which is exactly the discipline the
 * digest exists to enforce. Swap in `anthropic()` and the behaviour should be
 * recognisably the same.
 */

import type { ModelAdapter, ModelRequest, ModelResponse } from "@haikit/core";

let counter = 0;
const toolUse = (name: string, input: unknown) => ({
  type: "tool_use",
  id: `toolu_scripted${++counter}`,
  name,
  input,
});

/** Mirrors the strings `choose` returns in ./surfaces.ts. */
const CHOSE = /Chose ([^:]+): "([^"]+)"/;
const RANK = /Rank: #(\d+) of (\d+)/;
/**
 * Anchored to the selection line's own wording. A bare /right-to-left/ over the
 * whole tool_result also matches the digest's "N right-to-left." — which rides
 * along on every resolution — and would claim it of every language picked.
 */
const DIR = /script, (right-to-left|left-to-right),/;
const MATCHED = /^(\d+) of (\d+) match/m;
/** Mirrors the postcard sentence `choose` adds. */
const POSTED = /Posted it to (\w+) as a postcard/;

const SCRIPTS = ["latin", "arabic", "hebrew", "han", "japanese"];

async function say(text: string, onTextDelta: (t: string) => void): Promise<ModelResponse> {
  for (const chunk of text.match(/\S+\s*/g) ?? []) {
    onTextDelta(chunk);
    await new Promise((r) => setTimeout(r, 18));
  }
  return { content: [{ type: "text", text }], stop_reason: "end_turn" };
}

export function scripted(): ModelAdapter {
  return {
    id: "scripted",

    async generate({ messages, onTextDelta }: ModelRequest): Promise<ModelResponse> {
      const last = messages.at(-1);
      const results = Array.isArray(last?.content)
        ? (last.content as any[])
            .filter((b) => b?.type === "tool_result")
            .map((b) => b.content)
            .join("\n")
        : "";

      // ── reacting to a tool result ──────────────────────────────────
      if (results) {
        // The user picked a language. This is the payoff: the greeting text
        // comes out of the tool_result, not from any list this file holds.
        const chose = results.match(CHOSE);
        if (chose) {
          const [, language, greeting] = chose;
          const rank = results.match(RANK);
          const where = rank ? `${language}, #${rank[1]} of ${rank[2]} by speakers` : language;
          const dir = results.match(DIR)?.[1] === "right-to-left" ? " It reads right to left." : "";
          const to = results.match(POSTED)?.[1];
          const posted = to ? ` I've posted it to ${to} as a postcard.` : "";
          return say(`${greeting}\n\n— ${where}.${dir}${posted}`, onTextDelta);
        }

        // A query_ui dereference came back.
        const m = results.match(MATCHED);
        if (m) {
          return say(
            `${m[1]} of the ${m[2]} match — they're listed above. Pick one and I'll greet you in it.`,
            onTextDelta,
          );
        }

        return say("Done.", onTextDelta);
      }

      // ── reacting to a user message ─────────────────────────────────
      // Notices ride ahead of what the user typed, as text blocks; what they
      // typed is the last block.
      const typed = typeof last?.content === "string" ? last.content : (last?.content as any[] | undefined)?.at(-1)?.text;
      const text = String(typed ?? "").toLowerCase();
      // the picker as it is now: the latest digest of one, a revision's included
      const handle = [...JSON.stringify(messages).matchAll(/translations in \d+ scripts\.[^"]*?Rendered as (ui_\d+)/g)].at(-1)?.[1];
      // The latest notice of this name the history has taken in: its model text.
      const latest = (name: string) => {
        const prefix = `[App notification: ${name}] `;
        const texts = messages.flatMap((m) => (Array.isArray(m.content) ? (m.content as any[]) : []))
          .map((b) => b?.text)
          .filter((t): t is string => typeof t === "string");
        return texts.findLast((t) => t.startsWith(prefix))?.slice(prefix.length);
      };

      // A wake turn: a notification arrived on its own, and the user said
      // nothing. Tell them what changed.
      if (text.startsWith("[the user has not said anything")) {
        const reply = latest("reply_received");
        return say(reply ? `Heads up: ${reply}` : "Something changed; nothing you need to do.", onTextDelta);
      }

      if (/arrive|deliver|postcard/.test(text)) {
        // the latest postcard posted, and whether its own delivery has arrived
        const posted = [...JSON.stringify(messages).matchAll(/reference (PC-\d+); delivery is not confirmed/g)].at(-1)?.[1];
        const delivered = latest("postcard_delivered");
        return say(
          delivered && (!posted || delivered.includes(posted)) ? `Yes. ${delivered}` : "Not yet. I'll tell you when it's delivered.",
          onTextDelta,
        );
      }

      // An `inform` action would arrive as a plain user turn — check it before
      // the keyword branches so its text can't re-trigger a tool.
      if (text.startsWith("[ui interaction]")) {
        return say("Noted.", onTextDelta);
      }

      // The display path. Renders a card and keeps talking — the turn is never
      // parked, so there is no tool_result to wait for.
      const show = text.match(/(?:show|card|big|large).*\b(english|mandarin|spanish|arabic|japanese|hebrew)\b/);
      if (show) {
        const code = { english: "en", mandarin: "zh", spanish: "es", arabic: "ar", japanese: "ja", hebrew: "he" }[
          show[1]!
        ]!;
        onTextDelta("Here it is.");
        return {
          content: [
            { type: "text", text: "Here it is." },
            toolUse("show_greeting", { code }),
          ],
          stop_reason: "tool_use",
        };
      }

      // Dereference: only possible once a picker has been rendered.
      if (handle && /(right-to-left|rtl|left-to-right|ltr|script|latin|arabic|hebrew|han|japanese)/.test(text)) {
        const args: Record<string, unknown> = {};
        if (/right-to-left|rtl/.test(text)) args.rtl = true;
        else if (/left-to-right|ltr/.test(text)) args.rtl = false;

        const script = SCRIPTS.find((s) => text.includes(s));
        if (script) args.script = script[0]!.toUpperCase() + script.slice(1);

        onTextDelta("Checking the full list.");
        return {
          content: [
            { type: "text", text: "Checking the full list." },
            toolUse("query_ui", { handle, query: "filter", args }),
          ],
          stop_reason: "tool_use",
        };
      }

      // The elicit path. Parks the turn until the user clicks a row.
      if (/greet|hello|hi\b|hey|language|world|start/.test(text)) {
        onTextDelta("Pick a language.");
        return {
          content: [
            { type: "text", text: "Pick a language." },
            toolUse("list_greetings", {}),
          ],
          stop_reason: "tool_use",
        };
      }

      return say(
        `Try: "greet me", then "which ones are right-to-left?", then "show the hebrew one"`,
        onTextDelta,
      );
    },
  };
}
