# @haikit/core

## 0.2.0

### Minor Changes

- 2eeff96: Expose each query's argument schema to the model in `query_ui`.

  `query_ui` advertised `args: { type: "object" }` with no properties, and its
  catalogue listed only query names — so a model could see that `filter` existed
  but not that it took `rtl` or `script`. It called the query with no arguments,
  every filter became a no-op, and it got the whole collection back and answered
  from it. `QuerySpec.description` was never read at all.

  `query()` now takes an optional third argument, a JSON Schema for its args,
  mirroring `defineTool`'s existing `inputJsonSchema`. The derived `query_ui` tool
  lists each query with its description and that schema. A query missing it logs a
  warning at construction, because the failure mode is a wrong answer rather than
  an error.

  ```ts
  filter: query(
    z.object({ rtl: z.boolean().optional() }),
    "Greetings in a given writing direction",
    { type: "object", properties: { rtl: { type: "boolean" } } }
  );
  ```

  Additive and backwards compatible: existing two-argument calls still compile and
  behave as before, minus the silence.
