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
      // …and of the flights home shown last, for the same reason
      const flightsWith = (() => {
        for (const m of [...messages].reverse()) {
          const call = [...blocksOf(m)].reverse().find((b) => b?.type === "tool_use" && b.name === "show_flights");
          if (call) return (call.input ?? {}) as Record<string, unknown>;
        }
        return {};
      })();
      const texts = textsOf(last);
      const results = resultsOf(last).join("\n");
      // everything said so far, by either side, as one text to read from
      const history = messages.flatMap((m) => [...textsOf(m), ...resultsOf(m)]).join("\n");
      const latest = (re: RegExp) => [...history.matchAll(re)].at(-1);

      // ── the cancellation, however it arrived: usually on its own, in a wake
      //    turn, but with the traveller's message if they typed first. Either
      //    way it's the news, and it's read only once. ──
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

      // ── other news that arrived on its own: the traveller hasn't said anything ──
      if (texts.some((t) => t.startsWith("[The user has not said anything"))) {
        const gate = texts.map((t) => t.match(/^\[UI update\] (.+? moved from gate \S+ to gate \S+?)\. (Boarding is still [\d:]+)\./)).find(Boolean);
        const confirmed = texts.map((t) => t.match(/^\[App notification: seat_confirmed\] (.+)$/)).find(Boolean);
        if (gate) {
          return reply(`Heads up: ${gate[1]}. ${gate[2]}.${confirmed ? ` And ${lower(confirmed[1]!)}` : ""}`, onTextDelta);
        }
        return reply("Something changed on the airline's side, but there's nothing you need to do.", onTextDelta);
      }

      // ── a click answered a question, or a tool came back ──
      if (results) {
        // the flight home first: its labels say so, and the rebooking ones don't
        const home = homeStep(results, texts, latest);
        if (home) return reply(home.say, onTextDelta, home.call ? [home.call] : []);

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
          // about the flights home: the same, with their picker
          if (asked?.handle === latest(/Flights home on \w+, on screen as (ui_\d+)/g)?.[1]) {
            if (found[1] === "0") return reply("None of these flights match that. Here they are again.", onTextDelta, [toolUse("show_flights", flightsWith)]);
            if (asked.query === "cheapest") {
              const first = (results.split("\n")[1] ?? "").replace(/ \[r\d+\]$/, "");
              return reply(`The cheapest is ${first}.`, onTextDelta, [toolUse("show_flights", flightsWith)]);
            }
            const args = (asked.args ?? {}) as { nonstop?: boolean; airport?: string };
            const what = args.nonstop ? "nonstop" : args.airport === "HND" ? "from Haneda" : args.airport === "NRT" ? "from Narita" : "matching";
            return reply(`${found[1]} of the ${found[2]} flights are ${what}. Here they are.`, onTextDelta, [toolUse("show_flights", { ...flightsWith, ...args })]);
          }
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
      // Booking the flight home, by asking or by the trip card's button: the
      // day and the airport if they named them; the search fills in the rest.
      if (/\b(book|fly|flight|going|get me)\b.*\b(home|return|san francisco|sfo)\b|\bflight home\b/.test(text)) {
        const day = text.match(/\b(thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|mon(?:day)?)\b/)?.[1];
        const date = day ? day.charAt(0).toUpperCase() + day.slice(1, 3) : undefined;
        const from = /haneda|\bhnd\b/.test(text) ? "HND" : /narita|\bnrt\b/.test(text) ? "NRT" : undefined;
        return reply(
          date
            ? "Here's the search, filled in from your trip and your message. Check it, then search."
            : "Which day would you like to fly home? I've filled in the rest from your trip.",
          onTextDelta,
          [toolUse("start_booking", { ...(date && { date }), ...(from && { from }) })],
        );
      }
      // Typing closes the question that was waiting. When what they typed isn't
      // a request, open that question again, so there's still something to click.
      const closed = resultsOf(messages.at(-2)).find((r) => r.includes("User did not select; they said:")) ?? "";
      const choice = latest(/Chose (o\d+): /g)?.[1];
      const homeFlight = latest(/Chose flight (r\d+): /g)?.[1];
      const reopen = /^Search for flights home/.test(closed)
        ? toolUse("start_booking", { ...(closed.match(/ \((Thu|Fri|Sat|Sun|Mon)\)\./) && { date: closed.match(/ \((Thu|Fri|Sat|Sun|Mon)\)\./)![1] }) })
        : /^Flights home on/.test(closed)
          ? toolUse("show_flights", flightsWith)
          : /^Fares for/.test(closed) && homeFlight
            ? toolUse("show_fares", { flightId: homeFlight })
            : /^Seat map for .+, for the flight home,/.test(closed) && homeFlight
              ? toolUse("show_home_seats", { flightId: homeFlight })
              : /^Review of the booking/.test(closed)
                ? toolUse("review_booking", {})
                : /^Rebooking options/.test(closed)
        ? toolUse("find_rebooking", shownWith)
        : /^Seat map for/.test(closed) && choice
          ? toolUse("show_seat_map", { optionId: choice })
          : /^Choices for/.test(closed) && choice
            ? toolUse("offer_care", { optionId: choice })
            : null;
      // Questions about the picker shown last: the flights home, or the rebooking options.
      const flights = [...history.matchAll(/Flights home on \w+, on screen as (ui_\d+)/g)].at(-1);
      const rebooking = [...history.matchAll(/Rebooking options for \S+ \S+, on screen as (ui_\d+)/g)].at(-1);
      if (flights && (flights.index ?? 0) > (rebooking?.index ?? -1)) {
        const ask = (query: string, args: Record<string, unknown>, lead: string) =>
          reply(lead, onTextDelta, [toolUse("query_ui", { handle: flights[1], query, args })]);
        if (/non-?stop|direct/.test(text)) return ask("filter", { nonstop: true }, "Checking every flight for nonstops.");
        if (/cheap|lowest|least|price/.test(text)) return ask("cheapest", {}, "Checking which costs least.");
        if (/haneda|\bhnd\b/.test(text)) return ask("filter", { airport: "HND" }, "Checking which leave from Haneda.");
        if (/narita|\bnrt\b/.test(text)) return ask("filter", { airport: "NRT" }, "Checking which leave from Narita.");
        if (/flights|all of them|list|every/.test(text)) return reply("Here are all of them again.", onTextDelta, [toolUse("show_flights", {})]);
      }
      const options = rebooking?.[1];
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
      if (!history.includes("[App notification: flight_cancelled]") && !reopen) {
        return reply(
          "Your flight is on time, so there's nothing to do yet. In this demo the airline is played by the Airline ops panel: try Cancel the flight. " +
            "Or ask me to book your flight home.",
          onTextDelta,
        );
      }
      return reply(
        "I'm the scripted guide, so I understand a few kinds of request: “book my flight home on Sunday”, “which are nonstop?”, " +
          "“which is cheapest?”, “what lands first?”, or “show me all the options”. Set ANTHROPIC_API_KEY on the server to talk to Claude instead." +
          (reopen ? " Here's where you were." : ""),
        onTextDelta,
        reopen ? [reopen] : [],
      );
    },
  };
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

type Call = ReturnType<typeof toolUse>;

/**
 * The next step of booking the flight home, from a click's label or a tool's
 * result, or null when it isn't one. Each step's label names what the next
 * needs, such as the flight's id, so the guide reads nothing else.
 */
function homeStep(results: string, texts: string[], latest: (re: RegExp) => RegExpMatchArray | undefined): { say: string; call?: Call } | null {
  const searched = results.match(/Searched flights home: .+? to SFO on (\w+) \(/);
  if (searched) return { say: `Here are the flights home on ${searched[1]}. The prices are the Basic fare; pick one to see the others.`, call: toolUse("show_flights", {}) };

  const flight = results.match(/Chose flight (r\d+): (.+?) \(/);
  if (flight) return { say: `${flight[2]} it is. Pick a fare.`, call: toolUse("show_fares", { flightId: flight[1] }) };

  const fare = results.match(/Chose the (\w+) fare, \$[\d,]+, on (.+?) \[(r\d+)\]: (the traveller chooses a seat)?/);
  if (fare) {
    return fare[4]
      ? { say: `${fare[1]} it is. Pick a seat on ${fare[2]}.`, call: toolUse("show_home_seats", { flightId: fare[3] }) }
      : { say: `${fare[1]} assigns your seat at check-in, so here's your booking to check. Nothing is booked until you confirm.`, call: toolUse("review_booking", {}) };
  }

  const seat = results.match(/Picked seat (\w+) on .+?, for the flight home\./);
  if (seat) return { say: `Seat ${seat[1]}. Here's your booking to check. Nothing is booked until you confirm.`, call: toolUse("review_booking", {}) };

  const confirmed = results.match(/Confirmed the booking at (\$[\d,]+)\./);
  if (confirmed) {
    // a rise the airline made while the review was waiting rides with the click
    const rose = texts.some((t) => /^\[UI update\] The airline raised/.test(t));
    return {
      say: rose ? `Booked at the new total, ${confirmed[1]}: the fare went up while you were looking. Here's your e-ticket.` : "Booked. Here's your e-ticket.",
      call: toolUse("issue_ticket", {}),
    };
  }

  const change = results.match(/Asked to change the (flight|fare|seat)\./);
  if (change) {
    const id = latest(/Chose flight (r\d+): /g)?.[1];
    if (change[1] === "flight" || !id) return { say: "Here are the flights again.", call: toolUse("show_flights", {}) };
    if (change[1] === "fare") return { say: "Here are the fares again.", call: toolUse("show_fares", { flightId: id }) };
    return { say: "Pick another seat.", call: toolUse("show_home_seats", { flightId: id }) };
  }

  const ticket = results.match(/E-ticket on screen as \S+: .+?, booking (\w+), (.+?), leaving (\w+ [\d:]+)/);
  if (ticket) return { say: `You're booked home: ${ticket[2]}, leaving ${ticket[3]}, booking ${ticket[1]}. The airline will issue the ticket in a moment.` };

  return null;
}
