import { useId, useState } from "react";
import type { Block } from "../../shared/surfaces.ts";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { CODE } from "./inline.tsx";

type Picker = NonNullable<Extract<Block, { kind: "compare" }>["sides"][number]["picker"]>;

/**
 * A working select list for a comparison: radio buttons, so a keyboard and a
 * screen reader can use it as they would any form. Choosing is local to the
 * lesson, since no action is declared for it: the line under the list shows
 * what the click would send if this were the real question.
 */
export function Picker({ picker }: { picker: Picker }) {
  const [chosen, setChosen] = useState("");
  const caption = useId();
  return (
    <div>
      <p id={caption} className="mb-1.5 text-[12.5px] font-semibold text-muted-foreground">
        {picker.caption}
      </p>
      <RadioGroup aria-labelledby={caption} value={chosen} onValueChange={setChosen} className="gap-1">
        {picker.options.map((option) => (
          <label
            key={option.id}
            className="grid cursor-pointer grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-2.5 border border-hai-line bg-hai-panel px-2.5 py-[7px] text-[13.5px] hover:bg-hai-hover has-data-checked:border-hai-good has-data-checked:bg-hai-selected has-focus-visible:outline-2 has-focus-visible:outline-offset-1 has-focus-visible:outline-ring"
          >
            <RadioGroupItem value={option.id} />
            <span className="font-mono text-[13px] font-semibold">{option.label}</span>
            <span className="text-right text-muted-foreground">{option.detail}</span>
          </label>
        ))}
      </RadioGroup>
      {picker.more ? <p className="mt-0.5 text-[12.5px] text-muted-foreground">and {picker.more} more</p> : null}
      <p aria-live="polite" className="mt-2 text-[13px] text-hai-good">
        {chosen ? (
          <>
            Your click sends <code className={CODE}>{chosen}</code>
          </>
        ) : (
          "Choose one: the click is the answer."
        )}
      </p>
    </div>
  );
}
