# Tailwind CSS

The default UI is styled with Tailwind CSS v4. An app built with Tailwind v4
imports `@haikit/client/tailwind.css`, which brings the default UI's
stylesheet into its build and gives the app's own classes HaiKIT's tokens as
theme values. This page is exact about what it defines, where the default
UI's rules land in the cascade beside the app's, how a token is overridden,
and what `dark:` means on a HaiKIT page. The
[default UI guide](../default-ui.md) sets it up, under *With Vite and
Tailwind CSS*.

Exported by `@haikit/client`: the stylesheet `@haikit/client/tailwind.css`.

Checked against `@haikit/*` 0.27.0 and `tailwindcss` 4.3.3. Source:
`packages/client/src/tailwind.css`, `packages/client/styles/hai.css`,
`packages/client/styles/utilities.css`, `scripts/build-css.mjs` and
`packages/client/package.json`.

- [`tailwind.css`](#tailwindcss): importing it, and its theme values
- [The default UI's rules in your build](#the-default-uis-rules-in-your-build):
  layers, prefix, preflight
- [Overriding a token](#overriding-a-token)
- [Dark mode](#dark-mode)
- [Fonts](#fonts)

## `tailwind.css`

```css
@import "tailwindcss";
@import "@haikit/client/tailwind.css";
```

`tailwindcss` is an optional peer dependency of `@haikit/client`, at
`^4.0.0`. An app without Tailwind imports or links
[`hai.css`](ui.md#haicss) instead, and gets the same default UI.

`tailwind.css` is two things:

1. `@import "./hai.css"`: the default UI's stylesheet, so an app that imports
   `tailwind.css` doesn't import `hai.css` as well.
2. An `@theme inline` block: HaiKIT's tokens as Tailwind theme values, for
   your surfaces.

Import it after `tailwindcss`, in the stylesheet your bundler builds. With
Vite, that build needs `@tailwindcss/vite` in its plugins.

### Theme values

```html
<div class="border-3 border-hai-line bg-hai-panel text-hai-dim shadow-hai">
```

| Theme value | Is | Utilities |
| --- | --- | --- |
| `--color-hai-bg` | `var(--hai-bg)` | every colour utility: `bg-hai-bg`, `text-hai-bg`, `border-hai-bg`, `fill-hai-bg`, `ring-hai-bg`… |
| `--color-hai-panel` | `var(--hai-panel)` | `bg-hai-panel`… |
| `--color-hai-panel-2` | `var(--hai-panel-2)` | `bg-hai-panel-2`… |
| `--color-hai-line` | `var(--hai-line)` | `border-hai-line`… |
| `--color-hai-fg` | `var(--hai-fg)` | `text-hai-fg`… |
| `--color-hai-dim` | `var(--hai-dim)` | `text-hai-dim`… |
| `--color-hai-accent` | `var(--hai-accent)` | `bg-hai-accent`… |
| `--color-hai-on-accent` | `var(--hai-on-accent)` | `text-hai-on-accent`… |
| `--color-hai-good` | `var(--hai-good)` | `text-hai-good`… |
| `--color-hai-warn` | `var(--hai-warn)` | `bg-hai-warn`… |
| `--color-hai-bad` | `var(--hai-bad)` | `text-hai-bad`… |
| `--color-hai-user-bg` | `var(--hai-user-bg)` | `bg-hai-user-bg`… |
| `--color-hai-code-bg` | `var(--hai-code-bg)` | `bg-hai-code-bg`… |
| `--color-hai-selected` | `var(--hai-selected)` | `bg-hai-selected`… |
| `--color-hai-logo-ink` | `var(--hai-logo-ink)` | `fill-hai-logo-ink`… |
| `--color-hai-logo-paper` | `var(--hai-logo-paper)` | `fill-hai-logo-paper`… |
| `--color-hai-logo-hot` | `var(--hai-logo-hot)` | `fill-hai-logo-hot`… |
| `--color-hai-line-soft` | `var(--hai-line-soft)` | `border-hai-line-soft`… |
| `--color-hai-hover` | `var(--hai-hover)` | `hover:bg-hai-hover`… |
| `--color-hai-accent-soft` | `var(--hai-accent-soft)` | `bg-hai-accent-soft`… |
| `--color-hai-good-soft` | `var(--hai-good-soft)` | `bg-hai-good-soft`… |
| `--color-hai-warn-soft` | `var(--hai-warn-soft)` | `bg-hai-warn-soft`… |
| `--color-hai-bad-soft` | `var(--hai-bad-soft)` | `bg-hai-bad-soft`… |
| `--font-hai-sans` | `var(--hai-sans)` | `font-hai-sans` |
| `--font-hai-mono` | `var(--hai-mono)` | `font-hai-mono` |
| `--radius-hai` | `var(--hai-radius)` | `rounded-hai`, `rounded-t-hai`… |
| `--shadow-hai` | `var(--hai-shadow)` | `shadow-hai` |

The tokens themselves, their values in each scheme and what each is for, are
in [The default UI: tokens](ui.md#tokens). `--hai-column` and
`--hai-inspector-width` are layout tokens and have no theme value.

- **They're `inline`.** A utility uses the token itself, as in
  `background-color: var(--hai-panel)`, and the page gets no `--color-hai-*`
  variables. An override of a token reaches your surfaces as it reaches the
  default UI.
- **An opacity modifier mixes the token**, as in `bg-hai-accent/50`, so it
  follows an override and the scheme too.
- **They don't replace Tailwind's palette.** Every name starts `hai-`, so
  `bg-red-500` and a library's own colours, such as shadcn/ui's `bg-primary`,
  are there beside them.
- **No `dark:` is needed** with them: each token already has a value for each
  scheme (see [Dark mode](#dark-mode)).

## The default UI's rules in your build

`hai.css` arrives in your build already compiled. In HaiKIT's repository,
`npm run build:css` writes it: the hand-written rules in
`packages/client/styles/hai.css` (the tokens, one rule for the page, and the
keyframes), then the utilities that style everything the default UI renders,
compiled from the class names in `packages/client/src/classes.js`. Your
Tailwind build reads it as plain CSS. It compiles none of the default UI's
classes and doesn't need to scan `@haikit/client` for them.

- **Its rules are outside any cascade layer, but one block.** That block is
  Tailwind's `@layer properties` fallback, which gives the `--tw-*` variables
  its utilities read their starting values in browsers without `@property`.
  Tailwind puts preflight in `@layer base` and every utility, yours and a
  library's, in `@layer utilities`. An unlayered declaration beats a normal
  layered declaration of the same property whatever their specificity, so no
  normal rule in a layer changes a property the default UI sets on its own
  elements. Two things in a layer still can: an `!important` declaration,
  which beats every normal one, and a `--tw-*` variable the default UI's
  utilities read without setting, as `hai:border-2` reads
  `--tw-border-style`. Tailwind's utilities set those variables only on the
  element that carries the class, and they don't inherit. The default UI
  doesn't style the inside of your surfaces, so it never wins against your
  classes there.
- **Its utilities are prefixed `hai:`.** The rules are `.hai\:*` selectors,
  such as `.hai\:flex`: class names no page uses for itself. They're sized in
  pixels on a 1px spacing scale of their own, with Tailwind's theme inlined,
  so your theme, your `--spacing` and the root font size don't resize the
  chat. They aren't API, and change between versions. Each element also
  carries its hook, the `hai-*` class [The default UI](ui.md) names it by;
  restyle with the tokens, or with a rule of your own on a hook, unlayered and
  at least as specific as the default UI's.
- **Preflight changes nothing in the chat.** Each element the default UI
  builds sets what it needs itself, `box-sizing` included, so it looks the
  same with Tailwind's preflight as on a page with no reset.
- **One rule styles the page:** `:where(body:has(.hai-shell))` sets
  `margin: 0`, at zero specificity and unlayered. An unlayered `body` rule of
  yours wins; one inside a layer, as in `@layer base { body { margin: 1rem } }`,
  doesn't.
- **Three keyframes are global names:** `hai-pulse`, `hai-blink` and
  `hai-shimmer`. Don't define your own under those names.

## Overriding a token

```css
:root {
  --hai-accent: #3d6bff;
}
```

The defaults are set on `:where(:root)`, at zero specificity and outside any
layer. So:

- **An unlayered `:root` rule wins**, whatever order the two load in: its
  specificity is higher.
- **A `:root` rule inside a layer has no effect**, as in
  `@layer base { :root { --hai-accent: … } }`: the unlayered default beats it.
  Keep token overrides outside `@layer`.
- **One value per scheme:** `light-dark(light, dark)`. A browser without
  `light-dark()` falls back to the dark scheme, so put the plain dark value
  first and the pair under `@supports (color: light-dark(#000, #fff))`, as
  `hai.css` does:

  ```css
  :root { --hai-accent: #b07cff; }
  @supports (color: light-dark(#000, #fff)) {
    :root { --hai-accent: light-dark(#9f7aea, #b07cff); }
  }
  ```

Everything built on the tokens follows: the default UI, the theme values
above, and any library's colours pointed at them (see
[shadcn/ui](shadcn.md#colours)).

## Dark mode

The tokens take their light or dark value from `light-dark()`, which follows
the root element's `color-scheme`. `hai.css` sets it, at zero specificity:

| `<html>` | `color-scheme` | The tokens are |
| --- | --- | --- |
| no `data-hai-theme` | `light dark` | the system's scheme |
| `data-hai-theme="light"` | `light` | light |
| `data-hai-theme="dark"` | `dark` | dark |
| any, in a browser without `light-dark()` | `dark` | dark |

`mountChat`'s `theme` option sets and removes the attribute, and a page can
set it itself (see [The default UI: themes](ui.md#themes)).

`tailwind.css` defines no `dark` variant, and leaves an app's own as it is.
Tailwind's default `dark:` is `@media (prefers-color-scheme: dark)`: it
follows the system, but not a `data-hai-theme` pin. For `dark:` classes,
yours or a library's, to switch when the tokens do, define the variant by the
same rule:

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

With it, `dark:` applies inside a page pinned dark, and inside an unpinned
page on a dark system. Only in a browser without `light-dark()` do the two
differ: the tokens are dark there, and the variant still follows the system
and the pin.

## Fonts

`--hai-sans` and `--hai-mono` name Space Grotesk and Space Mono, with system
faces after them. `hai.css` doesn't load either face: link them on your page,
or the system's stand in. `font-hai-sans` and `font-hai-mono` use them.

Tailwind's own `font-sans` and `font-mono` are separate theme values, and
they set the page's face too: Tailwind's preflight gives `<html>` its
`--default-font-family`, which is `--font-sans`. The chat's shell sets its own
face, but anything rendered outside it, such as a pop-up in `document.body`,
takes the page's. To make them the chat's faces:

```css
@theme inline {
  --font-sans: var(--hai-sans);
  --font-mono: var(--hai-mono);
}
```
