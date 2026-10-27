import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { Popover } from "radix-ui";
import { GoogleLogoIcon, SignOutIcon, UserIcon, XIcon } from "@phosphor-icons/react";

/** Who's signed in, as `GET /auth/me` answers: their id and their token's claims, or null. */
export type Reader = { id: string; claims: Record<string, unknown> } | null;

/** Why a sign-in came back without one: the `sign_in_error` it came back with. */
export const SIGN_IN_ERRORS: Record<string, string> = {
  access_denied: "Signing in was cancelled.",
  refused: "That Google account can't sign in here.",
  expired: "That sign-in took too long, or had ended already. Try again.",
  failed: "Signing in with Google didn't work. Try again in a moment.",
};

/** What to say about a sign-in that came back with this `sign_in_error`, if it did: a code not listed as `failed`. */
export function signInError(code: string | null): string | undefined {
  if (code === null) return undefined;
  // the code is the address's: only the map's own, never one it inherits
  return Object.hasOwn(SIGN_IN_ERRORS, code) ? SIGN_IN_ERRORS[code] : SIGN_IN_ERRORS.failed;
}

const SIGN_OUT_FAILED = "Signing out didn't work. Try again in a moment.";

// A mouse resting on the picture opens the profile; leaving it and the
// profile closes it, after a moment to cross the gap between them.
const OPEN_MS = 150;
const CLOSE_MS = 200;

// as the header's own buttons look, its label hidden on a narrow screen
const BUTTON =
  "inline-flex h-[34px] flex-none cursor-pointer items-center gap-[7px] border-2 border-transparent px-2 text-[13px] font-semibold text-hai-dim hover:border-hai-line hover:bg-hai-hover hover:text-hai-fg disabled:cursor-default disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-hai-accent";

/**
 * Signing in with Google, at the end of the header: a link to sign in, or
 * the reader's picture, which shows who's signed in, and a button to sign
 * out. It's optional: signed out, the introduction is as it is without it.
 * Signing in or out leaves the page, so the conversation after it is a new one.
 */
export function Account({ reader, error }: { reader: Reader; error?: string }) {
  const [leaving, setLeaving] = useState(false);
  const [note, setNote] = useState(error);
  const said = note && <Note text={note} dismiss={() => setNote(undefined)} />;
  if (!reader) {
    return (
      <span className="relative inline-flex flex-none">
        <a href="/auth/google" className={BUTTON} title="Sign in with Google: the conversations you start are yours alone">
          <GoogleLogoIcon className="size-[18px]" />
          <span className="max-[900px]:sr-only">Sign in</span>
        </a>
        {said}
      </span>
    );
  }
  // leaves only once the cookie's gone: until then the reader is still signed in, and is told so
  const signOut = async () => {
    setLeaving(true);
    setNote(undefined);
    const ok = await fetch("/auth/sign-out", { method: "POST" }).then((res) => res.ok, () => false);
    if (ok) return location.assign("/");
    setLeaving(false);
    setNote(SIGN_OUT_FAILED);
  };
  return (
    <>
      <Profile reader={reader} />
      <span className="relative inline-flex flex-none">
        <button type="button" className={BUTTON} disabled={leaving} onClick={signOut}>
          <SignOutIcon className="size-[18px]" />
          <span className="max-[900px]:sr-only">Sign out</span>
        </button>
        {said}
      </span>
    </>
  );
}

/**
 * The reader's picture, and on it who's signed in: their picture and name,
 * and what signing in does. A mouse opens it by resting there; a tap, Enter
 * or Space opens it too, and Escape or a click elsewhere closes it.
 */
function Profile({ reader }: { reader: NonNullable<Reader> }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // open because a mouse rests there: its click then keeps it, as the reader came to see it
  const rested = useRef(false);
  useEffect(() => () => clearTimeout(timer.current), []);
  const name = typeof reader.claims.name === "string" ? reader.claims.name : undefined;
  const picture = pictureOf(reader);
  // only a mouse: a finger's pointer arrives with its tap, which opens it already
  const hover = (next: boolean, ms: number) => (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      rested.current = next;
      setOpen(next);
    }, ms);
  };
  const near = { onPointerEnter: hover(true, OPEN_MS), onPointerLeave: hover(false, CLOSE_MS) };
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        clearTimeout(timer.current);
        rested.current = false;
        setOpen(next);
      }}
    >
      <Popover.Trigger
        {...near}
        onClick={(event) => rested.current && event.preventDefault()}
        aria-label={name ? `${name}, signed in with Google` : "Signed in with Google"}
        className="inline-flex h-[34px] flex-none cursor-pointer items-center border-2 border-transparent px-1 hover:border-hai-line hover:bg-hai-hover focus-visible:outline-2 focus-visible:outline-hai-accent data-[state=open]:border-hai-line data-[state=open]:bg-hai-hover"
      >
        <Avatar name={name} picture={picture} className="size-6 text-[10px]" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          {...near}
          align="end"
          sideOffset={4}
          aria-label="Who's signed in"
          // it opens under a resting mouse too: the focus stays where the reader left it
          onOpenAutoFocus={(event) => event.preventDefault()}
          className="z-50 w-[min(18rem,calc(100vw-24px))] border-2 border-hai-line bg-hai-panel p-3 text-hai-fg shadow-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 motion-reduce:animate-none"
        >
          <div className="flex items-center gap-3">
            <Avatar name={name} picture={picture} className="size-12 text-base" />
            <div className="min-w-0">
              {name && <p className="truncate font-heading text-[15px] font-semibold">{name}</p>}
              <p className="flex items-center gap-1.5 text-xs text-hai-dim">
                <GoogleLogoIcon className="size-3.5 flex-none" />
                Signed in with Google
              </p>
            </div>
          </div>
          <p className="mt-3 border-t-2 border-hai-line pt-2.5 text-xs/snug text-hai-dim">
            The conversations you start while signed in are yours alone: no one else can open them.
          </p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Their Google picture's address, if their token has one: only from https. */
function pictureOf(reader: NonNullable<Reader>): string | undefined {
  const { picture } = reader.claims;
  return typeof picture === "string" && picture.startsWith("https://") ? picture : undefined;
}

/**
 * A picture of the reader, square as the header is: their initials, covered
 * by their Google picture once it loads. A picture that won't load leaves the
 * initials, and no name leaves a figure.
 */
function Avatar({ name, picture, className }: { name?: string; picture?: string; className: string }) {
  const [broken, setBroken] = useState(false);
  const letters = initials(name);
  return (
    <span className={`relative inline-flex flex-none items-center justify-center overflow-hidden bg-hai-accent-soft font-semibold text-hai-accent ${className}`}>
      {letters ? <span aria-hidden>{letters}</span> : <UserIcon aria-hidden className="size-3/5" />}
      {picture && !broken && (
        // Google is told nothing of the page it's shown on
        <img src={picture} alt="" referrerPolicy="no-referrer" className="absolute inset-0 size-full object-cover" onError={() => setBroken(true)} />
      )}
    </span>
  );
}

/** The first letters of someone's first and last names, "Ada Lovelace" as "AL": a letter at a time, so 田 stays whole. */
function initials(name = ""): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = (word: string) => Array.from(word)[0] ?? "";
  if (words.length === 0) return "";
  return (first(words[0]) + (words.length > 1 ? first(words[words.length - 1]) : "")).toUpperCase();
}

/** Why signing in or out didn't happen, under its control: the header has no room for it on a phone. */
function Note({ text, dismiss }: { text: string; dismiss: () => void }) {
  return (
    <span className="absolute top-full right-0 z-20 mt-1 flex w-max max-w-[min(32ch,calc(100vw-24px))] items-start gap-2 border-2 border-hai-line bg-hai-panel py-1.5 pr-1.5 pl-2.5">
      <span role="alert" className="text-xs/snug text-hai-bad">
        {text}
      </span>
      <button type="button" aria-label="Dismiss" className="flex-none cursor-pointer text-hai-dim hover:text-hai-fg" onClick={dismiss}>
        <XIcon className="size-3.5" />
      </button>
    </span>
  );
}
