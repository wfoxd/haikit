---
"@haikit/client": minor
---

`@haikit/client/tailwind.css`, for an app built with Tailwind CSS v4. Import it after Tailwind, `@import "tailwindcss"; @import "@haikit/client/tailwind.css";`, and it brings `hai.css` with it and gives your surfaces HaiKIT's tokens as theme values: a colour for every token (`bg-hai-panel`, `text-hai-dim`, `border-hai-line-soft`…), `font-hai-sans`, `font-hai-mono`, `rounded-hai` and `shadow-hai`. Each is the token itself, so an override on `:root` reaches your surfaces as it reaches the chat, in both schemes, and it defines no `dark` variant of its own. `tailwindcss` is an optional peer dependency: nothing changes for an app without it. `hai.css` is now built from the package's `styles/` folder in HaiKIT's repository, and is the same stylesheet as before.
