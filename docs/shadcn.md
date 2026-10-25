# shadcn/ui in a HaiKIT app

[shadcn/ui](https://ui.shadcn.com)'s components work inside HaiKIT's surfaces
as they are. [The tutorial](tutorial.md) builds its picker from them step by
step, and [`examples/hello`](../examples/hello) is what it ends with. This
page is the short version, for an app of your own: the setup, and the four
places a HaiKIT page differs from the apps shadcn's own instructions assume.

## Set it up

You need React with `@haikit/react`, and Vite with Tailwind CSS v4, as in
[The default UI](default-ui.md#with-vite-and-tailwind-css). shadcn's command
line tool then needs two things before it will set up:

- an `@/*` path alias in `tsconfig.json`, which it reads to learn where your
  browser code lives. Give your browser tsconfig and Vite's `resolve.alias`
  the same one;
- a stylesheet that imports Tailwind:

  ```css
  @import "tailwindcss";
  @import "@haikit/client/tailwind.css";
  ```

```bash
npx shadcn@latest init -b radix -p lyra
npx shadcn@latest add button card tooltip
```

Any preset works. Lyra's square, monospace look is the one that suits the
default UI.

## Colours: one block, from the tokens

`init` writes shadcn's colours twice, in a `:root` block and a `.dark` one.
Replace both with a single block that makes each one a HaiKIT
[token](default-ui.md#the-variables):

```css
:root {
  --background: var(--hai-panel);
  --foreground: var(--hai-fg);
  --card: var(--hai-panel);
  --card-foreground: var(--hai-fg);
  --popover: var(--hai-panel);
  --popover-foreground: var(--hai-fg);
  --primary: var(--hai-accent);
  --primary-foreground: var(--hai-on-accent);
  --secondary: var(--hai-panel-2);
  --secondary-foreground: var(--hai-fg);
  --muted: var(--hai-hover);
  --muted-foreground: var(--hai-dim);
  --accent: var(--hai-hover);
  --accent-foreground: var(--hai-fg);
  --destructive: var(--hai-bad);
  --border: var(--hai-line);
  --input: var(--hai-line);
  --ring: var(--hai-fg);
  --radius: var(--hai-radius);
}
```

Every `--hai-*` token already holds a light and a dark value, so one block
follows the chat's scheme, its light and dark pins, and any token you
override. Keep `init`'s `@theme inline` block, which turns these into
Tailwind colours, and point its fonts at the chat's if you want them:
`--font-sans: var(--hai-sans)` and `--font-mono: var(--hai-mono)`.

`init`'s `@layer base` also styles `body` and `html`, which the default UI
already styles; keep only its `*` rule, which gives shadcn's components their
border and focus ring colours.

## Dark mode: the chat's rule

shadcn's components use `dark:` classes, and `init` makes `dark:` mean "inside
a `.dark` element", a class HaiKIT never sets. Replace its `@custom-variant`
with the chat's rule, the system's scheme unless a `data-hai-theme` pin on
`<html>` chooses one:

```css
@custom-variant dark {
  @media (prefers-color-scheme: dark) {
    :root:not([data-hai-theme="light"]) & {
      @slot;
    }
  }
  :root[data-hai-theme="dark"] & {
    @slot;
  }
}
```

`@haikit/client/tailwind.css` defines no `dark` variant, so it never
overrides yours.

## Providers: around each surface

Each surface and notice is a React root of its own, so a provider around your
app never reaches it. shadcn's `Tooltip` needs a `TooltipProvider` above it,
and without one the surface's first render fails: it stays blank while its
tool row says *awaiting you*, and the only error is in the console. Pass the
providers a component needs as `wrapper`
([`ReactOptions`](reference/react.md#reactoptions)):

```tsx
function Providers({ children }: { children: ReactNode }) {
  return <TooltipProvider>{children}</TooltipProvider>;
}

export const registry = { greeting_picker: reactSurface(GreetingPicker, { wrapper: Providers }) };
```

The same goes for any context a component reads, such as a query client, a
router or a theme.

## Toasts: one Toaster, in a root of its own

Sonner's `toast()` works from inside any surface. Its queue lives outside
React, so one `<Toaster />` for the page shows them all. Mount it in a root of
its own, beside `mountChat`, somewhere it won't cover the message box:

```tsx
const toasts = document.body.appendChild(document.createElement("div"));
createRoot(toasts).render(<Toaster position="top-center" />);
```

shadcn's `sonner.tsx` asks `next-themes` for the theme. A HaiKIT page has no
theme provider, so it gets `"system"`, and the toast takes its colours from
`--popover`, `--popover-foreground` and `--border`, which the block above
already ties to the chat, pins included.

## Pop-ups

- **They're not clipped.** Select, Popover, Tooltip and Dialog render into
  `document.body`, outside the surface, so its frame doesn't cut them off and
  they sit above a docked window.
- **Escape closes them first.** The next press closes the Context drawer, or
  the dock's window.
- **Docking keeps state.** A docked surface's element is moved, never mounted
  again, so its React state carries over.
- **Close a dialog when the conversation expires.** An out-of-date surface is
  inert and its `send` does nothing, but a Dialog already open lives outside
  it and stays clickable:

  ```tsx
  useEffect(() => {
    if (expired) setOpen(false);
  }, [expired]);
  ```
