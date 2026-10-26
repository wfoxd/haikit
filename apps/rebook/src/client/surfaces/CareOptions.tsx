import { useRef } from "react";
import type { SurfaceProps } from "@haikit/react";
import type { careOptions } from "../../shared/surfaces.ts";
import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
import { useAsk } from "@/lib/ask";
import { useKeepFocus } from "@/lib/focus";
import { useShowTop } from "@/lib/scroll";
import { cn } from "@/lib/utils";
import { Foot, Head, PICKED, Surface } from "./parts.tsx";

/** Where the traveller spends tonight, when the new flight leaves tomorrow. */
export function CareOptions({ props, send, state, mode, selection }: SurfaceProps<typeof careOptions>) {
  const root = useRef<HTMLDivElement>(null);
  useKeepFocus(root);
  useShowTop(root, state);
  const { sending, picked, ask } = useAsk(state, selection);
  const live = state === "live" && mode === "elicit";

  return (
    <Surface ref={root}>
      <Head title="Where will you spend tonight?" sub={`${props.night}, before ${props.flight}`} />
      <CardContent className="grid gap-3.5">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-2">
          {props.choices.map((c) => (
            <Button
              key={c.id}
              variant="outline"
              data-key={`care:${c.id}`}
              disabled={!live || sending}
              // DECLARED
              onClick={() => ask(c.id, () => send("choose", c.id))}
              className={cn(
                "grid h-auto content-start justify-start justify-items-start gap-1 border-hai-line bg-secondary px-3.5 py-3 text-left whitespace-normal hover:border-primary hover:bg-secondary",
                c.id === picked && PICKED,
              )}
            >
              <span className="text-sm font-semibold">{c.title}</span>
              <span className="text-[13px] font-normal text-muted-foreground">{c.detail}</span>
            </Button>
          ))}
        </div>
        {state === "frozen" && !props.choices.some((c) => c.id === picked) && <Foot>Closed when you typed instead.</Foot>}
      </CardContent>
    </Surface>
  );
}
