# Logo

One line splitting in two: a tool's single execution, feeding the model a
short digest (blue, top) and the browser the full payload (green, bottom).
The default UI's header uses the same mark.

| File | Use it on |
| --- | --- |
| [`haikit-logo-light.svg`](haikit-logo-light.svg) | light backgrounds: dark wordmark |
| [`haikit-logo-dark.svg`](haikit-logo-dark.svg) | dark backgrounds: light wordmark |
| [`haikit-mark.svg`](haikit-mark.svg) | either: the mark alone, square, for avatars and favicons |

The mark's colours are mid-tones that read on light and dark alike, so only the
wordmark changes between the two logos:

| | |
| --- | --- |
| model channel | `#4b7bf5` |
| browser channel | `#22a06b` |
| input line | `#6b7685` |
| wordmark on light, "hai" / "kit" | `#161b22` / `#5b6675` |
| wordmark on dark, "hai" / "kit" | `#e6edf3` / `#8b949e` |

Everything is drawn as strokes, not text, so the logo looks the same whatever
fonts the viewer has. To show the right one for GitHub's theme:

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/haikit-logo-dark.svg">
  <img src="assets/haikit-logo-light.svg" alt="haikit" height="56">
</picture>
```
