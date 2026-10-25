import type { Block } from "../../shared/surfaces.ts";
import { inline, type Linker } from "./inline.tsx";

type Part = Extract<Block, { kind: "callout" }>["body"][number];

/** The body of a code note or a callout: a paragraph, or a list. */
export function Prose({ part, link }: { part: Part; link?: Linker }) {
  if (part.kind === "p") return <p>{inline(part.text, link)}</p>;
  return (
    <ul>
      {part.items.map((item, i) => (
        <li key={i}>{inline(item, link)}</li>
      ))}
    </ul>
  );
}
