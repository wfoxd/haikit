import type { ReactNode } from "react";
import type { Architecture as Arch } from "../../shared/surfaces.ts";
import { Inline } from "../blocks/inline.tsx";
import { Architecture } from "../drawings/Architecture.tsx";
import { Illustration } from "../drawings/Illustrations.tsx";

/**
 * A welcome stored before version 11: the diagram beside the lede, then
 * three sections, each a heading, an illustration and three points.
 */
export type LegacyWelcome = {
  architecture?: Arch;
  sections?: { title: string; lead: string; image?: { kind: string; alt: string }; points: { title: string; text: string }[] }[];
};

/**
 * The story as a welcome stored before version 11 tells it: the lede beside
 * the diagram, then its sections. Welcomes stored before versions 2 and 3
 * have no diagram and no sections; they still render.
 */
export function LegacyStory({ lede, props }: { lede: ReactNode; props: LegacyWelcome }) {
  // With room for both, the lede and the diagram sit side by side. The
  // diagram's wide drawing needs 580px, and its column (6/11 of the page,
  // less the gap) reaches that at 1120px of page.
  return (
    <>
      <div className="grid @min-[1120px]/page:mt-2.5 @min-[1120px]/page:mb-2 @min-[1120px]/page:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] @min-[1120px]/page:items-center @min-[1120px]/page:gap-12">
        {lede}
        {props.architecture && <Architecture arch={props.architecture} className="@min-[1120px]/page:m-0" />}
      </div>
      {(props.sections ?? []).map((section, i) => (
        <section key={i} className="@container mt-[34px] border-t border-hai-line-soft pt-[30px]">
          <div className="mb-[22px] grid gap-4 @min-[600px]:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)] @min-[600px]:items-center @min-[600px]:gap-7">
            <div>
              <h3 className="font-heading text-[21px]/[1.25] font-semibold tracking-[-0.015em] text-balance">{section.title}</h3>
              <p className="mt-1.5 max-w-[38ch] font-serif text-base/[1.5] text-pretty text-muted-foreground">{section.lead}</p>
            </div>
            {/* version 3 sections have no image; its illustration to the right edge, across from its title */}
            {section.image && <Illustration image={section.image} svgClassName="@min-[600px]:ml-auto" />}
          </div>
          {/* Each point spans two rows, title and text, as a subgrid: side by side, the texts line up even when a title wraps. */}
          <div className="grid grid-cols-1 gap-x-[22px] @min-[540px]:grid-cols-3">
            {section.points.map((point, j) => (
              <div key={j} className="row-span-2 mb-3.5 grid grid-rows-subgrid @min-[540px]:mb-0">
                <h4 className="mb-[5px] font-heading text-[14.5px]/[1.35] font-semibold text-balance">{point.title}</h4>
                <p className="font-sans text-sm/[1.55] text-muted-foreground">
                  <Inline text={point.text} />
                </p>
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
