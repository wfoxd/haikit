/**
 * Light syntax colouring for TypeScript and JavaScript: comments, strings,
 * keywords and numbers. It splits code into runs of text, each with a tone or
 * none, and the code block draws each run as text: nothing is parsed as HTML.
 */

export type Tone = "com" | "str" | "kw" | "num";
export interface Run {
  text: string;
  tone?: Tone;
}

/** Each tone's look, by what the run is. */
export const TONES: Record<Tone, string> = {
  com: "text-hai-dim italic",
  str: "text-hai-good",
  kw: "text-hai-accent",
  num: "text-hai-warn",
};

const LANGS = ["ts", "tsx", "js", "json"];

const TOKEN =
  /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(const|let|function|return|if|else|for|of|new|throw|async|await|export|import|from|type|interface|extends|true|false|null|undefined|typeof|as)\b|\b(\d[\d_]*)\b/g;

/** Code as runs. A language other than TypeScript, JavaScript or JSON is one plain run. */
export function highlight(code: string, lang: string): Run[] {
  if (!LANGS.includes(lang)) return [{ text: code }];
  const runs: Run[] = [];
  let at = 0;
  for (const m of code.matchAll(TOKEN)) {
    if (m.index > at) runs.push({ text: code.slice(at, m.index) });
    runs.push({ text: m[0], tone: m[1] ? "com" : m[2] ? "str" : m[3] ? "kw" : "num" });
    at = m.index + m[0].length;
  }
  if (at < code.length) runs.push({ text: code.slice(at) });
  return runs;
}

/**
 * Code as runs a line at a time, for code whose lines carry numbered notes,
 * carrying a comment that spans lines from one to the next.
 */
export function highlightLines(code: string, lang: string): Run[][] {
  const coloured = LANGS.includes(lang);
  let inComment = false;
  return code.split("\n").map((text) => {
    if (!coloured) return text ? [{ text }] : [];
    const runs: Run[] = [];
    let rest = text;
    if (inComment) {
      const end = rest.indexOf("*/");
      const upto = end < 0 ? rest.length : end + 2;
      runs.push({ text: rest.slice(0, upto), tone: "com" });
      rest = rest.slice(upto);
      inComment = end < 0;
    }
    const open = rest.indexOf("/*");
    if (open >= 0 && rest.indexOf("*/", open + 2) < 0) {
      runs.push(...highlight(rest.slice(0, open), lang), { text: rest.slice(open), tone: "com" });
      inComment = true;
    } else if (rest) {
      runs.push(...highlight(rest, lang));
    }
    return runs.filter((run) => run.text);
  });
}
