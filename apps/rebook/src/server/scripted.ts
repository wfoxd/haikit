/**
 * The scripted guide: a ModelAdapter that needs no API key, so the demo can
 * be deployed and used by anyone at no model cost.
 *
 * It holds to the discipline the demo is about. It never imports the demo's
 * data: everything it says is lifted from a digest, a click's label, a
 * notice or a query's answer, exactly what a real model would have read.
 */

import type { ModelAdapter, ModelRequest, ModelResponse } from "@haikit/core";

let counter = 0;
const toolUse = (name: string, input: unknown) => ({ type: "tool_use", id: `toolu_desk${++counter}`, name, input });

const pause = () => new Promise((r) => setTimeout(r, 14));

/** Stream the text a word at a time, then return it with any tool calls. */
async function reply(text: string, onTextDelta: (t: string) => void, calls: ReturnType<typeof toolUse>[] = []): Promise<ModelResponse> {
  for (const word of text.match(/\S+\s*/g) ?? []) {
    onTextDelta(word);
    await pause();
  }
  return { content: [{ type: "text", text }, ...calls], stop_reason: calls.length ? "tool_use" : "end_turn" };
}

type Message = ModelRequest["messages"][number];
const blocksOf = (m: Message | undefined): any[] =>
  !m ? [] : typeof m.content === "string" ? [{ type: "text", text: m.content }] : (m.content as any[]);
const textsOf = (m: Message | undefined) => blocksOf(m).filter((b) => b?.type === "text").map((b) => String(b.text));
const resultsOf = (m: Message | undefined) => blocksOf(m).filter((b) => b?.type === "tool_result").map((b) => String(b.content));

export function scripted(): ModelAdapter {
  return {
    id: "scripted guide",

    async generate({ messages, onTextDelta }: ModelRequest): Promise<ModelResponse> {
      const last = messages.at(-1);
      // The filters of the picker shown last: a new question narrows those, so
      // its answer and the picker that follows show the same options.
      const shownWith = (() => {
        for (const m of [...messages].reverse()) {
          const call = [...blocksOf(m)].reverse().find((b) => b?.type === "tool_use" && b.name === "find_rebooking");
          if (call) return (call.input ?? {}) as Record<string, boolean>;
        }
        return {};
      })();
      const texts = textsOf(last);
      const results = resultsOf(last).join("\n");
      // everything said so far, by either side, as one text to read from
      const history = messages.flatMap((m) => [...textsOf(m), ...resultsOf(m)]).join("\n");
      const latest = (re: RegExp) => [...history.matchAll(re)].at(-1);

      // ── news that arrived on its own: the traveller hasn't said anything ──
      if (texts.some((t) => t.startsWith("[The user has not said anything"))) {
        const cancelled = texts.find((t) => t.startsWith("[App notification: flight_cancelled]"));
        if (cancelled) {
          const [, flight, depart, reason] = cancelled.match(/\] (.+?), leaving San Francisco (.+?) for Tokyo, was cancelled because of (.+?)\./) ?? [];
          return reply(
            `I'm sorry: your ${depart?.slice(4) ?? ""} ${flight ?? "flight"} to Tokyo was cancelled because of ${reason ?? "a problem at the airline"}. ` +
              "You don't need to call anyone. Here's every way I can get you there.",
            onTextDelta,
            [toolUse("find_rebooking", {})],
          );
        }
        const gate = texts.map((t) => t.match(/^\[UI update\] (.+? moved from gate \S+ to gate \S+?)\. (Boarding is still [\d:]+)\./)).find(Boolean);
        const confirmed = texts.map((t) => t.match(/^\[App notification: seat_confirmed\] (.+)$/)).find(Boolean);
        if (gate) {
          return reply(`Heads up: ${gate[1]}. ${gate[2]}.${confirmed ? ` And ${lower(confirmed[1]!)}` : ""}`, onTextDelta);
        }
        return reply("Something changed on the airline's side, but there's nothing you need to do.", onTextDelta);
      }

      // ── a click answered a question, or a tool came back ──
      if (results) {
        const option = results.match(/Chose (o\d+): (.+?) \(/);
        if (option) {
          return reply(`${option[2]} it is. Pick a seat: other passengers are choosing too, so the map changes as you look.`, onTextDelta, [
            toolUse("show_seat_map", { optionId: option[1] }),
          ]);
        }
        const seat = results.match(/Picked seat (\w+) on (.+?)[ .(]/);
        if (seat) {
          const choice = latest(/Chose (o\d+): .*? (It leaves this evening|It leaves tomorrow)/g);
          if (choice?.[2] === "It leaves tomorrow") {
            return reply(`Seat ${seat[1]} is yours. Your new flight leaves tomorrow, so where would you like to spend tonight?`, onTextDelta, [
              toolUse("offer_care", { optionId: choice[1] }),
            ]);
          }
          return reply(`Seat ${seat[1]} is yours. Here's your new boarding pass.`, onTextDelta, [toolUse("issue_boarding_pass", {})]);
        }
        const care = results.match(/Chose (Hotel voucher|Lounge and dinner|I'll sort it myself)/);
        if (care) {
          return reply(care[1] === "I'll sort it myself" ? "Understood. Here's your boarding pass." : `${care[1]} it is. Here's your boarding pass.`, onTextDelta, [
            toolUse("issue_boarding_pass", {}),
          ]);
        }
        const pass = results.match(/Boarding pass on screen as \S+ .*?Seat (\w+), gate (\w+), boarding ([\d:]+)/);
        if (pass) {
          return reply(
            `You're booked: seat ${pass[1]}, gate ${pass[2]}, boarding at ${pass[3]}. I'll tell you if anything changes.`,
            onTextDelta,
          );
        }
        // a query_ui answer, already capped: say what it found, then show those as a picker
        const found = results.match(/^(\d+) of (\d+) match/m);
        if (found) {
          const asked = [...blocksOf(messages.at(-2))].reverse().find((b) => b?.type === "tool_use" && b.name === "query_ui")?.input;
          // Typing closed the picker the question was about, so open it again: none match, but those still do.
          if (found[1] === "0") {
            return reply("None of these options match that. Here they are again.", onTextDelta, [toolUse("find_rebooking", shownWith)]);
          }
          if (asked?.query === "earliest") {
            const first = results.split("\n")[1] ?? "";
            return reply(`The first to land is ${first.replace(/ \[o\d+\]$/, "")}.`, onTextDelta, [toolUse("find_rebooking", shownWith)]);
          }
          const args = (asked?.args ?? {}) as { nonstop?: boolean; noExtraFare?: boolean; tonight?: boolean };
          const what = args.nonstop ? "nonstop" : args.noExtraFare ? "at no extra cost" : args.tonight ? "leaving tonight" : "matching";
          return reply(`${found[1]} of the ${found[2]} options are ${what}. Here they are, the earliest to land first.`, onTextDelta, [
            // the query asked the picker on screen, already filtered: keep its filters
            toolUse("find_rebooking", { ...shownWith, ...args }),
          ]);
        }
        return reply(results.split("\n").at(-1) ?? "Done.", onTextDelta);
      }

      // ── what the traveller typed ──
      const text = (texts.at(-1) ?? "").toLowerCase();
      // Typing closes the question that was waiting. When what they typed isn't
      // a request, open that question again, so there's still something to click.
      const closed = resultsOf(messages.at(-2)).find((r) => r.includes("User did not select; they said:")) ?? "";
      const choice = latest(/Chose (o\d+): /g)?.[1];
      const reopen = /^Rebooking options/.test(closed)
        ? toolUse("find_rebooking", shownWith)
        : /^Seat map for/.test(closed) && choice
          ? toolUse("show_seat_map", { optionId: choice })
          : /^Choices for/.test(closed) && choice
            ? toolUse("offer_care", { optionId: choice })
            : null;
      const options = latest(/Rebooking options for \S+ \S+, on screen as (ui_\d+)/g)?.[1];
      const ask = (args: Record<string, boolean>, lead: string) =>
        reply(lead, onTextDelta, [toolUse("query_ui", { handle: options, query: "filter", args })]);
      if (options) {
        if (/non-?stop|direct/.test(text)) return ask({ nonstop: true }, "Checking every option for nonstops.");
        if (/free|no extra|cost|cheap|pay/.test(text)) return ask({ noExtraFare: true }, "Checking which cost nothing extra.");
        if (/tonight|today|this evening/.test(text)) return ask({ tonight: true }, "Checking which leave tonight.");
        if (/earliest|soonest|first|fastest|quickest/.test(text)) {
          return reply("Checking which lands first.", onTextDelta, [toolUse("query_ui", { handle: options, query: "earliest", args: {} })]);
        }
        if (/option|rebook|alternative|other way|all of them|list/.test(text)) {
          return reply("Here are all of them again.", onTextDelta, [toolUse("find_rebooking", {})]);
        }
      }
      if (!history.includes("[App notification: flight_cancelled]")) {
        return reply(
          "Your flight is on time, so there's nothing to do yet. In this demo the airline is played by the Airline ops panel: try Cancel the flight.",
          onTextDelta,
        );
      }
      return reply(
        "I'm the scripted guide, so I understand a few kinds of request: “which are nonstop?”, “which are free?”, " +
          "“what lands first?”, or “show me all the options”. Set ANTHROPIC_API_KEY on the server to talk to Claude instead." +
          (reopen ? " Here's where you were." : ""),
        onTextDelta,
        reopen ? [reopen] : [],
      );
    },
  };
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
