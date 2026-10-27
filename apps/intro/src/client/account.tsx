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
 * the reader's picture, which shows who's signed in and offers to sign out.
 * It's optional: signed out, the introduction is as it is without it.
 * Signing in or out leaves the page, so the conversation after it is a new one.
 */
export function Account({ reader, error }: { reader: Reader; error?: string }) {
  const [note, setNote] = useState(error);
  if (reader) return <Profile reader={reader} />;
  return (
    <span className="relative inline-flex flex-none">
      <a href="/auth/google" className={BUTTON} title="Sign in with Google: the conversations you start are yours alone">
        <GoogleLogoIcon className="size-[18px]" />
        <span className="max-[900px]:sr-only">Sign in</span>
      </a>
      {note && <Note text={note} dismiss={() => setNote(undefined)} />}
    </span>
  );
}

/**
 * The reader's picture, and on it who's signed in: their picture and name,
 * what signing in does, and Sign out. A mouse resting there opens it, and
 * leaving closes it. A click, a tap or a key opens it to stay, as does a
 * click on the picture or in it once it's open: then Escape, a click
 * elsewhere or on the picture closes it.
 */
function Profile({ reader }: { reader: NonNullable<Reader> }) {
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // opened, or clicked in, to stay, until it next opens under a resting mouse
  const kept = useRef(false);
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const name = typeof reader.claims.name === "string" ? reader.claims.name : undefined;
  const picture = pictureOf(reader);

  const show = (next: boolean) => {
    clearTimeout(timer.current);
    if (!next) setFailed(false);
    setOpen(next);
  };
  // only a mouse: a finger's pointer arrives with its tap, which opens it already
  const hover = (next: boolean, ms: number) => (event: PointerEvent) => {
    if (event.pointerType !== "mouse" || (open && kept.current)) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (next) kept.current = false;
      show(next);
    }, ms);
  };
  const near = { onPointerEnter: hover(true, OPEN_MS), onPointerLeave: hover(false, CLOSE_MS) };
  const keep = () => {
    clearTimeout(timer.current);
    kept.current = true;
  };

  // leaves only once the cookie's gone: until then the reader is still signed in, and is told so
  const signOut = async () => {
    setLeaving(true);
    setFailed(false);
    const ok = await fetch("/auth/sign-out", { method: "POST" }).then((res) => res.ok, () => false);
    if (ok) return location.assign("/");
    setLeaving(false);
    setFailed(true);
  };

  return (
    <Popover.Root
      open={open}
      // a click, a tap or a key on the picture, Escape, or a click elsewhere;
      // closed, it was kept, for the focus to go back to the picture
      onOpenChange={(next) => {
        if (next) kept.current = true;
        show(next);
      }}
    >
      <Popover.Trigger
        {...near}
        // open under a resting mouse, a click there keeps it, rather than closing what the reader came to see
        onClick={(event) => {
          if (open && !kept.current) {
            event.preventDefault();
            keep();
          }
        }}
        aria-label={name ? `${name}, signed in with Google` : "Signed in with Google"}
        className="inline-flex h-[34px] flex-none cursor-pointer items-center border-2 border-transparent px-1 hover:border-hai-line hover:bg-hai-hover focus-visible:outline-2 focus-visible:outline-hai-accent data-[state=open]:border-hai-line data-[state=open]:bg-hai-hover"
      >
        <Avatar name={name} picture={picture} className="size-6 text-[10px]" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          {...near}
          ref={card}
          onPointerDown={keep}
          align="end"
          sideOffset={4}
          aria-label="Who's signed in"
          // Opened to stay, the focus moves in, so Tab reaches Sign out. Under
          // a resting mouse, it stays where the reader left it, the message
          // they're typing say, both as it opens and as it closes.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            if (kept.current) card.current?.focus();
          }}
          onCloseAutoFocus={(event) => kept.current || event.preventDefault()}
          className="z-50 w-[min(18rem,calc(100vw-24px))] border-2 border-hai-line bg-hai-panel p-3 text-hai-fg shadow-sm outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 motion-reduce:animate-none"
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
          <button type="button" className={`${BUTTON} mt-2 w-full`} disabled={leaving} onClick={signOut}>
            <SignOutIcon className="size-[18px]" />
            Sign out
          </button>
          {failed && (
            <p role="alert" className="mt-1 px-2 text-xs/snug text-hai-bad">
              {SIGN_OUT_FAILED}
            </p>
          )}
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

/** Why a sign-in didn't happen, under the link: the header has no room for it on a phone. */
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
