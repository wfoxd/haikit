---
"@haikit/client": minor
---

A new look for the default UI, neo-brutalist: hard 3px borders in `--hai-line`, `4px 4px 0` offset shadows, square corners (`--hai-radius` is now `0`), on a cream page in the light scheme. Every colour token has a new value; the reference lists them. Tool rows that want something stand out on a shadow: a running row is white, one awaiting you is amber, a failed one pink with a red shadow. Settled rows lie flat. Each row shows its status as a coloured dot and a bordered badge.

Some tokens change meaning as well as value. `--hai-warn` is now a bright amber in both schemes, a fill rather than a text colour: write on it in `--hai-on-accent`, which is ink in both schemes. `--hai-accent` is the logo's orange. `--hai-selected` is a colour of its own, no longer mixed from `--hai-good`. `--hai-hover` is `--hai-warn` at 35%. The `-soft` tints are now solid, 25% of their colour in `--hai-panel`, so they look the same on the page as on a card. `--hai-sans` and `--hai-mono` now lead with Space Grotesk and Space Mono, which `hai.css` doesn't load: link them on your page, or the system's faces stand in.

The markup is unchanged.
