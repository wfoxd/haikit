---
"@haikit/client": patch
---

Escape from inside the model context debug drawer closes the drawer, even with the dock's pile list open behind it. It used to close the list instead, and leave the drawer open. From inside the dock, or with the drawer closed, Escape still closes the pile's list, then the window.
