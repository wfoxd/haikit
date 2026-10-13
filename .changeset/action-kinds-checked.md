---
"@haikit/server": patch
---

`createHai` now refuses a surface action whose kind isn't `"resolve"` or `"inform"`, or that has no `input` schema, with a `TypeError` naming it. A misspelled kind used to pass both of a click's gates, and could answer a question with the wrong surface's click. And clicks and `query_ui` now only accept names a surface declares itself: one every object inherits, such as `toString`, is refused as `unbound action` or an unsupported query, instead of failing further on.
