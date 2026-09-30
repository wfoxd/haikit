---
"@haikit/client": patch
---

The default transcript keeps following new messages after a tall surface is shown (#27). It used to scroll before a surface had mounted, so it aimed at a bottom that then moved, and it worked out whether to follow from the geometry on every render. The first tall surface pushed the bottom out of range, and it never scrolled again.

It now remembers whether the reader is following, and only their own scrolling changes that. It scrolls once surfaces have mounted, and keeps new content in view as surfaces grow afterwards. A reader who has scrolled up keeps their place through a turn, even when surfaces above them only get their height after they mount, and a new conversation starts out following.
