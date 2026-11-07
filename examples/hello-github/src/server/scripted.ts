/**
 * A scripted ModelAdapter so the app runs with no API key.
 *
 * It lives in the APP, not the framework — which is the point of the adapter
 * seam. `ModelAdapter` is one method; anything that satisfies it plugs in, and
 * the runtime cannot tell the difference.
 *
 *   HAI_SCRIPTED=1 npm start
 *
 * Note what this file does NOT do: it never reads GREETINGS, or asks GitHub
 * anything. It only ever sees what a real model would see — the digests, the
 * tool results and the notices — and never a token or a connect link. Every
 * claim it makes is extracted from those strings, which is exactly the
 * discipline the digest exists to enforce. Swap in `anthropic()` and the
 * behaviour should be recognisably the same.
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
/** Mirror the strings in ./surfaces.ts and ./tools.ts. */
const CARD = /^Shown: a button for the user to (?:connect (.+?)(?: again)?|give (.+?) more access)[.,]/;
const LISTED = /^(\d+) issues? match(?:es)? (".*?")(?:, the first (\d+) shown)?[:.]/;
const READ = /^([\w.-]+\/[\w.-]+#\d+), as GitHub sent it\./;
const GITHUB_SAID_NO = /^GitHub reported an error (?:for the search|reading)\b.*$/m;
/** owner/name, as a user types a repository. */
const REPO = /\b([\w.-]+\/[\w.-]+)\b/;

const SCRIPTS = ["latin", "arabic", "hebrew", "han", "japanese"];

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

/** What read_issue's text says of the issue: GitHub's JSON, read as any model would read it. */
function issueOf(text: string) {
  const title = text.match(/"title":("(?:[^"\\]|\\.)*")/)?.[1];
  const comments = text.match(/"comments":(\d+)/)?.[1];
  return {
    title: title ? JSON.parse(title) : "untitled",
    state: text.match(/"state":"(\w+)"/)?.[1] ?? "in an unknown state",
    author: text.match(/"user":\{"login":"([^"]+)"/)?.[1] ?? "someone",
    // GitHub leaves the count out when there are none; past textOf's cut, it isn't known
    comments: comments !== undefined ? Number(comments) : /\[Cut at \d+ of \d+ characters\.\]/.test(text) ? null : 0,
  };
}

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
        // GitHub: a button to connect it, the issues found, one issue, or a no
        const card = results.match(CARD);
        if (card) return say(`Connect ${card[1] ?? card[2]} with the button above, and I'll carry on once you have.`, onTextDelta);

        const listed = results.match(LISTED);
        if (listed) {
          const [, total, query, shown] = listed;
          if (total === "0") return say(`No issues match ${query}.`, onTextDelta);
          return say(`${total} ${total === "1" ? "issue matches" : "issues match"} ${query}${shown ? `; here are the first ${shown}` : ""}. Open one to read it on GitHub.`, onTextDelta);
        }

        const read = results.match(READ);
        if (read) {
          const i = issueOf(results);
          const comments = i.comments === null ? "" : `, with ${i.comments === 1 ? "1 comment" : `${i.comments} comments`}`;
          return say(`${read[1]}, ${JSON.stringify(i.title)}, is ${i.state}: opened by ${i.author}${comments}.`, onTextDelta);
        }

        const no = results.match(GITHUB_SAID_NO);
        if (no) return say(no[0], onTextDelta);

        // The user picked a language. This is the payoff: the greeting text
        // comes out of the tool_result, not from any list this file holds.
        const chose = results.match(CHOSE);
        if (chose) {
          const [, language, greeting] = chose;
          const rank = results.match(RANK);
          const where = rank ? `${language}, #${rank[1]} of ${rank[2]} by speakers` : language;
          const dir = results.match(DIR)?.[1] === "right-to-left" ? " It reads right to left." : "";
          return say(`${greeting}\n\n— ${where}.${dir}`, onTextDelta);
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
      const typed = String((typeof last?.content === "string" ? last.content : (last?.content as any[] | undefined)?.at(-1)?.text) ?? "");
      const text = typed.toLowerCase();
      // the picker's handle, from the latest digest of one: the connect card and the issue list have handles too
      const handle = [...JSON.stringify(messages).matchAll(/translations in \d+ scripts\.[^"]*?Rendered as (ui_\d+)/g)].at(-1)?.[1];

      // A wake turn: the user connected GitHub, and said nothing. Make the
      // call that was waiting for it again.
      if (text.startsWith("[the user has not said anything")) {
        const waiting = waitingCall(messages);
        if (waiting) return call("You're connected. Picking up where we left off.", waiting.name, waiting.input, onTextDelta);
        return say("You're connected.", onTextDelta);
      }

      // An `inform` action would arrive as a plain user turn — check it before
      // the keyword branches so its text can't re-trigger a tool.
      if (text.startsWith("[ui interaction]")) {
        return say("Noted.", onTextDelta);
      }

      // GitHub, before the greeting branches: "greetings" is a repository's name too.
      // One issue: "read issue 12 in owner/repo", or "owner/repo#12".
      const repo = typed.match(REPO)?.[1];
      const number = typed.match(/#(\d+)\b/)?.[1] ?? typed.match(/\bissue (\d+)\b/i)?.[1];
      if (repo && number) return call("Reading it on GitHub.", "read_issue", { repo, number: Number(number) }, onTextDelta);
      // "find issues about hebrew in owner/repo"
      if (/\bissues?\b/.test(text)) {
        const about = typed.match(/\babout (.+?)(?= in [\w.-]+\/|$)/i)?.[1]?.trim() || "is:open";
        return call("Searching GitHub.", "find_issues", { query: about.slice(0, 200), ...(repo ? { repo } : {}) }, onTextDelta);
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
        // the name welcome found, as any model would read it from the history
        const name = JSON.stringify(messages).match(/Signed in as (.+?)\. GitHub/)?.[1];
        const line = name ? `Hi ${name}! Pick a language.` : "Pick a language.";
        onTextDelta(line);
        return {
          content: [
            { type: "text", text: line },
            toolUse("list_greetings", {}),
          ],
          stop_reason: "tool_use",
        };
      }

      return say(
        `Try: "greet me", "find issues about hebrew in haikit-demo/greetings", or "read issue 12 in haikit-demo/greetings"`,
        onTextDelta,
      );
    },
  };
}
