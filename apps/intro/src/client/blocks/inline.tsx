/**
 * Inline `code`, **bold**, *italic* and [links](ref:tools) in the course's
 * text, as elements. Bold may hold code or italics, as in **`defineSurface`**,
 * and a link's label may hold code. Anything else stays text: React writes it
 * with textContent, never as HTML. Tool payloads are untrusted input, even
 * when the tool is your own.
 */

import { Fragment, type Key, type ReactNode } from "react";

/** Inline code's look. */
export const CODE = "border border-hai-line-soft bg-hai-code-bg px-[0.3em] py-[0.05em] font-mono text-[0.86em] whitespace-nowrap";

/** A link's look: to a section of the page, another page, or off the site. */
export const LINK = "text-primary underline decoration-1 underline-offset-2 hover:decoration-2 [&_code]:text-inherit";

/** An https link's mark: it opens in a new tab. */
export const OUT = "after:text-[0.8em] after:content-['_↗']";

/**
 * How a link becomes an element: given its target, its label already drawn,
 * and the label as plain text. See `Block` in ../../shared/surfaces.ts for
 * the targets there are.
 */
export type Linker = (target: string, label: ReactNode, key: Key, text: string) => ReactNode;

/**
 * Without a linker, an https link opens in a new tab and any other link is its
 * label alone: it has nowhere to go outside a reference page.
 */
export const plainLink: Linker = (target, label, key) =>
  /^https:\/\//.test(target) ? (
    <a key={key} className={`${LINK} ${OUT}`} href={target} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  ) : (
    <Fragment key={key}>{label}</Fragment>
  );

// a link, whose label may hold code; code, between runs of one or more
// backticks, so ``a `b` c`` holds a backtick; bold; italic
const INLINE = /\[((?:`[^`]*`|[^\]`])+)\]\(([^)\s]+)\)|(?<!`)(`+)(?!`)(.+?)(?<!`)\3(?!`)|\*\*(.+?)\*\*|\*([^*\s][^*]*?)\*/g;

/** One space each side of code is padding, so the code can start or end with a backtick. */
const unpad = (code: string) => (/^ .*[^ ].* $/.test(code) ? code.slice(1, -1) : code);

/** Text with its marks drawn: what a reader sees, as elements. */
export function inline(text: string, link: Linker = plainLink): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  for (const m of text.matchAll(INLINE)) {
    const key = m.index;
    if (m.index > at) out.push(text.slice(at, m.index));
    if (m[1] != null) out.push(link(m[2] ?? "", inline(m[1]), key, plain(m[1])));
    else if (m[4] != null)
      out.push(
        <code key={key} className={CODE}>
          {unpad(m[4])}
        </code>,
      );
    else if (m[5] != null) out.push(<strong key={key}>{inline(m[5], link)}</strong>);
    else out.push(<em key={key}>{inline(m[6] ?? "", link)}</em>);
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/** Text with its marks taken out: what a reader reads, as a string. */
export function plain(text: string): string {
  return text.replace(INLINE, (_all, label?: string, _target?: string, _ticks?: string, code?: string, bold?: string, italic?: string) =>
    label != null ? plain(label) : code != null ? unpad(code) : plain(bold ?? italic ?? ""),
  );
}

/** {@link inline} as a component, for text in JSX. */
export function Inline({ text, link }: { text: string; link?: Linker }) {
  return <>{inline(text, link)}</>;
}
