---
"@haikit/client": patch
---

`chat.start()` now tries again after an init that threw. It used to stop as soon as the server had sent a conversation id, and the server sends one before init runs, so a failed start could only be retried by sending a message. It now stops once the server has recorded the conversation's opening, as the docs already said.
