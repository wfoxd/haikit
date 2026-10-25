import type { SurfaceProps } from "@haikit/react";
import type { lesson } from "../../shared/surfaces.ts";
import { Blocks } from "../blocks/Blocks.tsx";
import { BODY, PAGE, PageTitle, Where } from "./parts.tsx";

/** Same estimate the server uses for the context drawer: about four characters a token. */
const tokens = (value: unknown) => Math.ceil(JSON.stringify(value).length / 4);

/** A lesson is display-only: nothing to freeze, nothing to send. */
export function Lesson({ props }: SurfaceProps<typeof lesson>) {
  return (
    <article className={PAGE}>
      <header>
        <Where aside={`${props.minutes} min read`}>
          Part {props.part.n}: {props.part.title}
        </Where>
        <PageTitle n={props.id}>{props.title}</PageTitle>
        <p className="mt-2.5 max-w-[60ch] font-serif text-lg/[1.5] text-muted-foreground italic">{props.summary}</p>
      </header>
      <div className={BODY}>
        <Blocks blocks={props.blocks} />
      </div>
      {/* The recap is the digest's own takeaways: what the model was told. */}
      <footer className="mt-[30px] border-l-3 border-hai-accent bg-hai-accent-soft px-[18px] pt-3.5 pb-3 font-sans">
        <h3 className="mb-1.5 text-sm font-bold text-hai-accent">What the model was told</h3>
        <ul className="list-disc pl-[1.1em] text-[15px]/[1.5] [&>li]:mb-1">
          {props.takeaways.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
        <p className="mt-2.5 text-[13px] text-hai-good">
          Everything above this box, about {tokens(props).toLocaleString("en")} tokens, stayed in your browser. The model received
          these lines as the lesson's digest.
        </p>
      </footer>
    </article>
  );
}
