---
"@haikit/core": minor
"@haikit/server": minor
"@haikit/client": minor
"@haikit/postgres": minor
"@haikit/react": minor
---

A tool can now revise a surface in place, closing the spec's open `ui_patch`. `ctx.update(surface, handle, props)` is typed, validated and digested like `ctx.render`, and resolves the same way, with the new digest for the model. It stores the revision as a new surface with a new handle that supersedes the old one. A click on the old handle is refused, its freshness window stops counting, `query_ui` on it says what it is now, and a question waiting on it waits on the revision. Answered surfaces can't be revised.

The browser gets a `ui_open` with `replaces`. The client moves the surface's record and transcript block to the new handle, keeping the same element. It hands the new props to a new `SurfaceInstance.update(props)`, which keeps the component's own state; without it, the component is mounted again in place. `ctx.send` follows the surface to its current handle, and each surface keeps its own deadline. `reactSurface` implements `update`. A wake turn's snapshot folds a revision into the surface it replaces.

**For custom stores:** a `Conversation` may carry `superseded` (old handle → new). A store must return it as given. `@haikit/postgres`'s `migrate()` adds the column.
