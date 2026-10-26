import { useState } from "react";

/**
 * The parked-turn pattern every question here shares: a click sends the
 * declared action and waits, with the surface's controls disabled and the
 * choice marked. If the surface is still live afterwards, the server refused
 * it: the reason shows in the transcript, the mark goes, and the traveller
 * can try again. A send that fails outright does the same.
 *
 *   const { sending, picked, ask } = useAsk(state, selection);
 *   <Button onClick={() => ask(o.id, () => send("choose", o.id))} />
 *
 * @param state the surface's state: once frozen, `picked` is the answer the
 *   server recorded, `selection`
 */
export function useAsk(state: string, selection: unknown) {
  const [sending, setSending] = useState(false);
  const [asked, setAsked] = useState<unknown>(undefined);

  /** Send one answer: `value` is what the click marks while it's on its way. */
  const ask = async (value: unknown, send: () => Promise<void>) => {
    setSending(true);
    setAsked(value);
    try {
      await send();
    } catch (err) {
      console.error("[rebook] the click wasn't sent:", err);
    } finally {
      setSending(false);
      setAsked(undefined); // refused, or never sent; once frozen, `selection` says what was chosen
    }
  };

  return { sending, picked: state === "frozen" ? selection : asked, ask };
}
