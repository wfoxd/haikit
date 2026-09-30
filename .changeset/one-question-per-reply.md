---
"@haikit/server": patch
---

A model reply can ask only one question. When Claude made two or more blocking tool calls in one reply, every surface was shown, but only the last could be answered. The other calls never got a `tool_result`, so the Messages API refused every later request in that conversation (#24).

The first elicit surface a reply renders is now the one the turn waits on. A later one is neither stored nor shown, and its call gets `Not shown: ui_01 is already waiting for the user. Ask this again after it is answered.`, which is sent along with the answer. Display surfaces are not limited.

The turn now waits on the question a call showed, even when the tool returns something else. A call that asks and then throws has its question withdrawn, so a later call in the same reply can ask instead.
