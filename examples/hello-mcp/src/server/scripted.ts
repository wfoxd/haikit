/**
 * A scripted ModelAdapter so the app runs with no API key, as in the other
 * examples. It only ever sees what a real model would: the tools' digests and
 * results, and the notices. It never sees a token, a connect link or anything
 * Notes, Calendar or Almanac said that a tool didn't pass on.
 *
 *   HAI_SCRIPTED=1 npm start
 */

import type { ModelAdapter, ModelRequest, ModelResponse } from "@haikit/core";

let counter = 0;
const toolUse = (name: string, input: unknown) => ({
  type: "tool_use",
  id: `toolu_scripted${++counter}`,
  name,
  input,
});

/** Mirrors the strings in ./surfaces.ts and ./tools.ts. */
const CARD = /^Shown: a button for the user to (?:connect (.+?)(?: again)?|give (.+?) more access)[.,]/;
const LISTED = /^(.+)'s (\d+) notes, newest first/;
const SAVED = /^Saved to .+'s notes: (".*")\.$/m;
const NOT_SAVED = /^Not saved: /m;
const DISCARDED = /^Discarded: /m;
const AGENDA = /'s calendar today: (.+)\.$/;
const DAY = /^(\w+ \d{4}-\d{2}-\d{2}): day (\d+) of (\d+)\./;

async function say(text: string, onTextDelta: (t: string) => void): Promise<ModelResponse> {
  for (const chunk of text.match(/\S+\s*/g) ?? []) {
    onTextDelta(chunk);
    await new Promise((r) => setTimeout(r, 18));
  }
  return { content: [{ type: "text", text }], stop_reason: "end_turn" };
}

function call(line: string, name: string, input: unknown, onTextDelta: (t: string) => void): ModelResponse {
  onTextDelta(line);
  return { content: [{ type: "text", text: line }, toolUse(name, input)], stop_reason: "tool_use" };
}

/**
 * The latest call that showed a connect card instead of doing its work, and
 * hasn't been made again since: what a wake turn makes again, once the user
 * has connected.
 */
function waitingCall(messages: ModelRequest["messages"]) {
  const calls = new Map<string, { name: string; input: unknown }>();
  let waiting: { name: string; input: unknown } | undefined;
  for (const m of messages) {
    for (const b of Array.isArray(m.content) ? (m.content as any[]) : []) {
      if (b?.type === "tool_use") {
        calls.set(b.id, b);
        if (b.name === waiting?.name) waiting = undefined;
      }
      if (b?.type === "tool_result" && typeof b.content === "string" && CARD.test(b.content)) waiting = calls.get(b.tool_use_id);
    }
  }
  return waiting;
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
        // a click on a draft: its label rides after the draft's digest
        const saved = results.match(SAVED);
        if (saved) return say(`Saved to Notes: ${saved[1]}.`, onTextDelta);
        if (NOT_SAVED.test(results)) return say("I couldn't save it: Notes needs connecting again. Ask to see your notes, and connect it there.", onTextDelta);
        if (DISCARDED.test(results)) return say("Discarded. Nothing was saved.", onTextDelta);

        const card = results.match(CARD);
        if (card) return say(`Connect ${card[1] ?? card[2]} with the button above, and I'll carry on once you have.`, onTextDelta);

        const listed = results.match(LISTED);
        if (listed) return say(`Here are your ${listed[2]} notes, from ${listed[1]}'s Notes account.`, onTextDelta);

        const agenda = results.match(AGENDA);
        if (agenda) return say(`Today: ${agenda[1]}.`, onTextDelta);

        const day = results.match(DAY);
        if (day) return say(`It's ${day[1]}, day ${day[2]} of ${day[3]}.`, onTextDelta);

        return say("Done.", onTextDelta);
      }

      // ── reacting to a user message ─────────────────────────────────
      // Notices ride ahead of what the user typed, as text blocks; what they
      // typed is the last block.
      const typed = String((typeof last?.content === "string" ? last.content : (last?.content as any[] | undefined)?.at(-1)?.text) ?? "");
      const text = typed.toLowerCase();

      // A wake turn: the user connected an account, and said nothing. Make
      // the call that was waiting for it again.
      if (text.startsWith("[the user has not said anything")) {
        const waiting = waitingCall(messages);
        if (waiting) return call("You're connected. Picking up where we left off.", waiting.name, waiting.input, onTextDelta);
        return say("You're connected.", onTextDelta);
      }

      if (text.startsWith("[ui interaction]")) return say("Noted.", onTextDelta);

      // a draft, never a write: the user saves it with a click
      const note = typed.match(/\bnote[:,]\s*(.+)/i) ?? typed.match(/^remember(?: to)? (.+)/i);
      if (note) return call("Here's the note. Save it if it looks right.", "draft_note", { text: note[1]!.trim().slice(0, 500) }, onTextDelta);

      if (/\bnotes?\b/.test(text)) return call("Looking in Notes.", "show_notes", {}, onTextDelta);
      if (/calendar|agenda|events?\b|schedule|meetings?/.test(text)) return call("Checking your calendar.", "show_agenda", {}, onTextDelta);
      if (/what day|date|today/.test(text)) return call("Asking the almanac.", "what_day", {}, onTextDelta);

      return say(`Try: "show my notes", "note: water the plants", "what's on my calendar?" or "what day is it?"`, onTextDelta);
    },
  };
}
