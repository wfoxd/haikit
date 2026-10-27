import { useState, type ReactNode } from "react";
import { reactSurface, type SurfaceProps } from "@haikit/react";
import type { greetingCard, greetingPicker } from "../shared/surfaces.ts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

function GreetingPicker({ props, send, mode, state, selection }: SurfaceProps<typeof greetingPicker>) {
  const [script, setScript] = useState("all");
  const live = state === "live" && mode === "elicit";

  const scripts = [...new Set(props.greetings.map((g) => g.script))].sort();
  const rows = props.greetings.filter((g) => script === "all" || g.script === script);
  const choose = (code: string) => send("choose", code);

  return (
    <Card className="gap-3 rounded-none bg-transparent py-3 shadow-none ring-0">
      <CardHeader className="px-3">
        <CardTitle>Pick a language</CardTitle>
        <CardDescription>
          {rows.length} of {props.greetings.length} greetings
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 px-3">
        <ToggleGroup type="single" variant="outline" size="sm" className="flex-wrap" value={script} onValueChange={(v) => v && setScript(v)}>
          {["all", ...scripts].map((sc) => (
            <ToggleGroupItem key={sc} value={sc}>
              {sc}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div>
          {rows.map((g) => (
            <div key={g.code} className="flex items-center gap-3 border-b border-border/40 py-1.5">
              <span className="flex-1 text-[15px]" dir={g.rtl ? "rtl" : undefined}>
                {g.text}
              </span>
              <Tooltip>
                <TooltipTrigger className="font-mono text-xs text-muted-foreground">{g.language}</TooltipTrigger>
                <TooltipContent>{g.speakersM}M speakers</TooltipContent>
              </Tooltip>
              {live ? (
                <Button size="sm" variant="outline" aria-label={`Choose ${g.language}`} onClick={() => choose(g.code)}>
                  Choose
                </Button>
              ) : g.code === selection ? (
                <Badge>picked</Badge>
              ) : null}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// A display surface never parks the turn, so it is never frozen and there is
// nothing to resolve. `copy` is an `inform`: a line added to the
// conversation after the fact.
function GreetingCard({ props: { greeting: g }, send }: SurfaceProps<typeof greetingCard>) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard?.writeText(g.text).catch(() => {});
    setCopied(true);
    void send("copy", { code: g.code });
  };

  return (
    <Card className="rounded-none bg-transparent shadow-none ring-0">
      <CardHeader>
        <CardTitle className="text-[28px] leading-tight" dir={g.rtl ? "rtl" : undefined}>
          {g.text}
        </CardTitle>
        <CardDescription className="font-mono text-xs">
          {g.language} · {g.script} · {g.speakersM}M speakers
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button size="sm" variant="outline" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </CardContent>
    </Card>
  );
}

function Providers({ children }: { children: ReactNode }) {
  return <TooltipProvider>{children}</TooltipProvider>;
}

export const registry = {
  greeting_picker: reactSurface(GreetingPicker, { wrapper: Providers }),
  greeting_card: reactSurface(GreetingCard, { wrapper: Providers }),
};
