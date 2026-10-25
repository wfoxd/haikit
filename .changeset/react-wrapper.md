---
"@haikit/react": minor
---

`reactSurface` and `reactNotice` take a second argument, `{ wrapper }`: a component rendered around yours every time, with it as `children`, for the providers it needs. Each surface and notice is a React root of its own, so a provider around the rest of the app never reaches it, and a component that needs one, such as shadcn/ui's `Tooltip` without its `TooltipProvider`, failed its first render and left the surface blank. The wrapper is there from the first, synchronous render, and for every freeze, revision and expiry after it; it's mounted once per surface, so a revision keeps its state as it keeps the component's. `ReactOptions` is its type. Without the option nothing changes.
