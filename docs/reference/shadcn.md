# shadcn/ui

[shadcn/ui](https://ui.shadcn.com)'s components work inside surfaces and
notices written with [`@haikit/react`](react.md). HaiKIT has no shadcn package
and no code of its own for it: this page is exact about what a HaiKIT page
does that shadcn's components meet, and what each part of shadcn's setup does
there. Its colours, its `dark:` variant and its base rules; the React root
each surface is; and what the default UI does with a pop-up, Escape, a docked
surface and an out-of-date one. [shadcn/ui in a HaiKIT app](../shadcn.md) is
the setup, as a guide.

Checked against `@haikit/*` 0.27.0 and `shadcn` 4.22.1, set up as
`examples/hello` is: `npx shadcn@latest init -b radix -p lyra`. Source:
`packages/react/src/index.ts`, `packages/client/src/index.js`,
`packages/client/src/app.js`, `packages/client/src/classes.js`,
`packages/client/styles/hai.css`, and `examples/hello/src/client/globals.css`.

- [What it needs](#what-it-needs)
- [Colours](#colours): shadcn's variables from the tokens
- [Dark mode](#dark-mode)
- [shadcn's base rules beside the default UI](#shadcns-base-rules-beside-the-default-ui)
- [Providers](#providers)
- [Pop-ups](#pop-ups), [Escape](#escape), [Docking](#docking),
  [Out of date](#out-of-date)
- [Toasts](#toasts)

## What it needs

- **React**, through `@haikit/react`: each component is registered with
  [`reactSurface`](react.md#reactsurface) or
  [`reactNotice`](react.md#reactnotice).
- **Tailwind CSS v4**, with [`@haikit/client/tailwind.css`](tailwind.md)
  imported after `tailwindcss`.
- **An `@/*` path alias in `tsconfig.json`.** shadcn's command line tool reads
  it to learn where browser code lives, and stops without it. A component
  that uses another imports it through the alias, as Toggle Group imports
  `@/components/ui/toggle`, so the browser tsconfig and the bundler need the
  same alias: in Vite, `resolve.alias`.

`init` writes `components.json`, which `add` reads, and rewrites the
stylesheet: it imports `tw-animate-css` and `shadcn/tailwind.css` (shadcn's
`data-*` variants and its accordion keyframes), and adds a `dark` variant, an
`@theme inline` block, its colours in a `:root` and a `.dark` block, and
`@layer base` rules. The sections below say what each of those does on a
HaiKIT page.

## Colours

`init` writes shadcn's colours twice, in `:root` and `.dark`, as fixed
values. On a HaiKIT page they belong to the tokens instead, in one block:

```css
:root {
  --background: var(--hai-panel);
  --foreground: var(--hai-fg);
  /* … */
}
```

| shadcn variable | Token in `examples/hello` | shadcn's components use it for |
| --- | --- | --- |
| `--background` | `--hai-panel` | the page and outline buttons |
| `--foreground` | `--hai-fg` | text |
| `--card`, `--popover` | `--hai-panel` | cards; menus, popovers and toasts |
| `--card-foreground`, `--popover-foreground` | `--hai-fg` | their text |
| `--primary` | `--hai-accent` | the default button, badge, checked controls |
| `--primary-foreground` | `--hai-on-accent` | text on `--primary` |
| `--secondary` | `--hai-panel-2` | secondary buttons and badges |
| `--secondary-foreground` | `--hai-fg` | text on `--secondary` |
| `--muted` | `--hai-hover` | muted fills, a hovered ghost or outline button |
| `--muted-foreground` | `--hai-dim` | descriptions and secondary text |
| `--accent` | `--hai-hover` | a highlighted menu item |
| `--accent-foreground` | `--hai-fg` | text on `--accent` |
| `--destructive` | `--hai-bad` | destructive buttons and alerts |
| `--border`, `--input` | `--hai-line` | borders, and inputs' borders |
| `--ring` | `--hai-fg` | the focus ring |
| `--radius` | `--hai-radius` | corners: `init`'s `--radius-sm` to `--radius-xl` are made from it |

- **One block, not two.** Every `--hai-*` token holds a light and a dark
  value, so one `:root` block follows the chat's scheme, its pins and any
  token a page overrides (see [Tailwind CSS: overriding a
  token](tailwind.md#overriding-a-token)). Keep it outside `@layer`, as the
  tokens' own overrides are.
- **Keep `init`'s `@theme inline` block.** It makes `--color-background`,
  `--color-primary` and the rest from these variables, and those are what
  `bg-background`, `text-primary` and shadcn's other classes use.
- **shadcn's accent isn't HaiKIT's.** shadcn's `--accent` is a hover tint;
  HaiKIT's accent is shadcn's `--primary`. `bg-accent` and `bg-hai-accent` are
  different colours, and both exist, since `tailwind.css` names its colours
  `hai-*`.
- **`--chart-*` and `--sidebar-*`**, which `init` also writes, aren't in
  `examples/hello`, whose components don't use them. Map any a component
  needs to a token the same way.
- **Fonts are theme values, not variables.** `examples/hello` sets
  `--font-sans: var(--hai-sans)`, `--font-mono: var(--hai-mono)` and
  `--font-heading: var(--hai-mono)` in the `@theme inline` block: Lyra's card
  titles use `font-heading`.

## Dark mode

shadcn's components carry `dark:` classes, such as an outline button's
`dark:bg-input/30`. `init` defines the variant as `&:is(.dark *)`: inside an
element with the class `dark`. HaiKIT never sets that class, so with `init`'s
variant `dark:` never applies, and in the dark scheme those classes keep
their light-scheme look on dark tokens.

Replace it with the chat's rule, given in
[Tailwind CSS: dark mode](tailwind.md#dark-mode): `dark:` then applies when
the system is dark and the page isn't pinned light, or when it's pinned dark,
which is when the tokens are dark. `tailwind.css` defines no `dark` variant,
so it never overrides yours.

## shadcn's base rules beside the default UI

`init` adds rules in `@layer base`:

| Rule | On a HaiKIT page |
| --- | --- |
| `*`: `border-border outline-ring/50` | Gives shadcn's components their border and focus-ring colours. On the default UI's own elements it changes nothing: `hai.css` is outside any layer, so the colours it sets win (see [Tailwind CSS: the default UI's rules](tailwind.md#the-default-uis-rules-in-your-build)). |
| `body`: `bg-background text-foreground` | `mountChat`'s shell covers the page with its own background, so only text inherited outside it changes: a pop-up's, for one. |
| `html`: `font-mono`, with the Lyra preset | The chat's shell sets its own face, so this sets only the face of what's rendered outside it, such as pop-ups and toasts in `document.body`. |

`examples/hello` keeps only the `*` rule, and gives the page the chat's faces
through the theme's fonts instead (see [Tailwind CSS: fonts](tailwind.md#fonts)).

## Providers

Each surface and each notice is a React root of its own, so a provider around
the rest of the page never reaches it. A component that needs one, such as
`Tooltip`, which needs a `TooltipProvider`, throws on its first render, and
the surface stays blank. Pass the providers as
[`ReactOptions`](react.md#reactoptions)' `wrapper`, which is rendered around
every render of the component:

```tsx
function Providers({ children }: { children: ReactNode }) {
  return <TooltipProvider>{children}</TooltipProvider>;
}

export const registry = { greeting_picker: reactSurface(GreetingPicker, { wrapper: Providers }) };
```

## Pop-ups

shadcn's Select, Popover, Tooltip, Dropdown Menu and Dialog render their
content through Radix's portal, into `document.body`: outside the surface's
element and outside the chat's shell.

- **They're not clipped.** A surface's frame clips what's inside it
  (`overflow: hidden`); a pop-up isn't inside it.
- **They sit above the chat.** Their content is `z-50`. The default UI's
  highest layers are the model context drawer at `z-index: 10`, the dock's
  pile and its list at 6, the dock's window at 5 and the drawer's sticky
  header at 1.
- **They take the page's font and colours**, not the shell's: the face
  `<html>` has, and the text colour `<body>` has, unless the component sets
  its own (see [shadcn's base rules](#shadcns-base-rules-beside-the-default-ui)).

## Escape

Radix closes a pop-up on Escape from a `keydown` listener on the document, in
the capture phase, and calls `preventDefault()` on the event when it does.
The default UI's own Escape handlers, both on the chat's shell, ignore an
event whose default is prevented: the drawer's, and the dock's, which closes
the pile's list and then the window. So the first Escape closes the pop-up, and
the next one what the default UI has open.

## Docking

Docking moves a surface's element into the dock's window, and Put back moves
it back. It's never unmounted and mounted again: the React root, its state,
its refs and its effects carry over, and nothing renders because of the move.
While the window is closed, the element is `hidden`, so a component that
measures itself then measures nothing. A pop-up that was open stays where it
was, in `document.body`.

## Out of date

When the conversation goes out of date, the client seals each surface: its
element becomes `inert` and gets `data-expired`, and the component renders
again with `expired: true`. Its `send` then resolves without sending. A
pop-up is outside the element, so it isn't inert, and stays open and clickable
until the component closes it:

```tsx
useEffect(() => {
  if (expired) setOpen(false);
}, [expired]);
```

## Toasts

Sonner's `toast()` works from any surface or notice: its queue is outside
React, so one `<Toaster />` shows them all, mounted in a root of its own
beside `mountChat`:

```tsx
const toasts = document.body.appendChild(document.createElement("div"));
createRoot(toasts).render(<Toaster position="top-center" />);
```

shadcn's `sonner.tsx` reads its theme from `next-themes`' `useTheme()`, with
`"system"` when there's none, as on a HaiKIT page, which has no theme
provider. Its colours are `--popover`, `--popover-foreground` and `--border`,
and its corners `--radius`, so with the block in [Colours](#colours) a toast
follows the chat's scheme and its pins.
