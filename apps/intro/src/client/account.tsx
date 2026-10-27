import { useState } from "react";
import { GoogleLogoIcon, SignOutIcon, XIcon } from "@phosphor-icons/react";

/** Who's signed in, as `GET /auth/me` answers: their id and their token's claims, or null. */
export type Reader = { id: string; claims: Record<string, unknown> } | null;

/** Why a sign-in came back without one: the `sign_in_error` it came back with. */
export const SIGN_IN_ERRORS: Record<string, string> = {
  access_denied: "Signing in was cancelled.",
  refused: "That Google account can't sign in here.",
  expired: "That sign-in took too long, or had ended already. Try again.",
  failed: "Signing in with Google didn't work. Try again in a moment.",
};

// as the header's own buttons look, its label hidden on a narrow screen
const BUTTON =
  "inline-flex h-[34px] flex-none cursor-pointer items-center gap-[7px] border-2 border-transparent px-2 text-[13px] font-semibold text-hai-dim hover:border-hai-line hover:bg-hai-hover hover:text-hai-fg disabled:cursor-default disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-hai-accent";

/**
 * Signing in with Google, at the end of the header: a link to sign in, or
 * the reader's name and a button to sign out. It's optional: signed out, the
 * introduction is as it is without it. Signing in or out leaves the page, so
 * the conversation after it is a new one.
 */
export function Account({ reader, error }: { reader: Reader; error?: string }) {
  const [leaving, setLeaving] = useState(false);
  const [note, setNote] = useState(error);
  if (!reader) {
    return (
      <span className="relative inline-flex flex-none">
        <a href="/auth/google" className={BUTTON} title="Sign in with Google: the conversations you start are yours alone">
          <GoogleLogoIcon className="size-[18px]" />
          <span className="max-[900px]:sr-only">Sign in</span>
        </a>
        {/* why a sign-in didn't happen, under the link: the header has no room for it on a phone */}
        {note && (
          <span className="absolute top-full right-0 z-20 mt-1 flex w-max max-w-[min(32ch,calc(100vw-24px))] items-start gap-2 border-2 border-hai-line bg-hai-panel py-1.5 pr-1.5 pl-2.5">
            <span role="alert" className="text-xs/snug text-hai-bad">
              {note}
            </span>
            <button type="button" aria-label="Dismiss" className="flex-none cursor-pointer text-hai-dim hover:text-hai-fg" onClick={() => setNote(undefined)}>
              <XIcon className="size-3.5" />
            </button>
          </span>
        )}
      </span>
    );
  }
  const name = typeof reader.claims.name === "string" ? reader.claims.name : "Signed in";
  const signOut = async () => {
    setLeaving(true);
    await fetch("/auth/sign-out", { method: "POST" }).catch(() => {});
    location.assign("/");
  };
  return (
    <>
      <span className="max-w-[16ch] truncate text-[13px] text-hai-dim max-[560px]:hidden" title={`Signed in with Google as ${name}`}>
        {name}
      </span>
      <button type="button" className={BUTTON} disabled={leaving} onClick={signOut}>
        <SignOutIcon className="size-[18px]" />
        <span className="max-[900px]:sr-only">Sign out</span>
      </button>
    </>
  );
}
