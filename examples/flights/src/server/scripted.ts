/**
 * A scripted ModelAdapter so the app runs with no API key.
 *
 * It lives in the APP, not the framework — which is the point of the adapter
 * seam: anything satisfying `ModelAdapter` plugs in, and the runtime cannot
 * tell the difference.
 */

import type { ModelAdapter, ModelRequest, ModelResponse } from "@haikit/core";

let counter = 0;
const toolUse = (name: string, input: unknown) => ({
  type: "tool_use",
  id: `toolu_scripted${++counter}`,
  name,
  input,
});

const FLIGHT_ID = /Selected: .*?\b([A-Z]{2}\d{2,4})\b/;

async function say(text: string, onTextDelta: (t: string) => void): Promise<ModelResponse> {
  for (const chunk of text.match(/\S+\s*/g) ?? []) {
    onTextDelta(chunk);
    await new Promise((r) => setTimeout(r, 16));
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
        if (/^Selected:/m.test(results)) {
          // Grounded strictly in what the tool_result said. Pick the most
          // expensive flight and this does NOT claim "cheapest nonstop".
          const id = results.match(FLIGHT_ID)?.[1] ?? "that flight";
          const lead = /cheapest nonstop/.test(results)
            ? `Good pick — ${id} is the cheapest nonstop on the board.`
            : `${id} it is.`;
          return say(`${lead} Want me to pull up the seat map?`, onTextDelta);
        }
        if (/^Seat map/m.test(results)) {
          const free = results.match(/(\d+) of \d+ seats free/)?.[1];
          return say(`Seat map's up — ${free} seats open. Rows 20 and 26 have extra legroom.`, onTextDelta);
        }
        if (/match\./.test(results)) {
          const m = results.match(/^(\d+) of (\d+) match/m);
          return say(
            m ? `${m[1]} of the ${m[2]} match — they're listed above.` : "Here's what matched.",
            onTextDelta,
          );
        }
        return say("Done.", onTextDelta);
      }

      // ── reacting to a user message ─────────────────────────────────
      const text = (typeof last?.content === "string" ? last.content : "").toLowerCase();
      const handle = JSON.stringify(messages).match(/ui_\d+/)?.[0];

      // An `inform` arrives as a plain user turn. Check it BEFORE the keyword
      // branches, or "Picked seat 20D" re-triggers the seat map tool.
      if (text.startsWith("[ui interaction]")) {
        return say("Noted. Anything else before I hold it?", onTextDelta);
      }

      if (/seat/.test(text)) {
        const flightId = JSON.stringify(messages).match(FLIGHT_ID)?.[1];
        if (!flightId) return say("Pick a flight first and I'll pull its seat map.", onTextDelta);
        onTextDelta("Pulling the seat map.");
        return {
          content: [{ type: "text", text: "Pulling the seat map." }, toolUse("show_seat_map", { flightId })],
          stop_reason: "tool_use",
        };
      }

      if (handle && /(under|below|cheap|nonstop|non-stop|direct|less than|\$\d+)/.test(text)) {
        const maxPrice = Number(text.match(/\$?(\d{3,4})/)?.[1]) || undefined;
        const nonstop = /nonstop|non-stop|direct/.test(text) || undefined;
        onTextDelta("Checking the full result set.");
        return {
          content: [
            { type: "text", text: "Checking the full result set." },
            toolUse("query_ui", { handle, query: "filter", args: { maxPrice, nonstop } }),
          ],
          stop_reason: "tool_use",
        };
      }

      if (/flight|tokyo|nrt|fly|find|search/.test(text)) {
        onTextDelta("Searching.");
        return {
          content: [
            { type: "text", text: "Searching." },
            toolUse("search_flights", { origin: "SFO", destination: "NRT", date: "2026-03-14" }),
          ],
          stop_reason: "tool_use",
        };
      }

      return say(
        `Try: "find me flights to Tokyo next Friday", then "any nonstops under $500?", then "show me the seat map".`,
        onTextDelta,
      );
    },
  };
}
