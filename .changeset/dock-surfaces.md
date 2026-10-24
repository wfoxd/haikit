---
"@haikit/client": minor
---

Dock a surface. With `mountChat`'s new `dock` option, on by default, every surface gets a bar with its name and a Dock button. Docked, it leaves a stub with Put back in the transcript and waits on a shelf above the message box, from where it opens as a window, one at a time, with Remove from dock. Its element is moved, never mounted again, so its component keeps its state. A docked question stays amber on the shelf, and the status line and placeholder say it's in the dock; a surface that changes while docked is marked until opened; when the shelf is full, the oldest go into a pile that lists them. On a narrow screen the window is a sheet over the chat. `dock: false` leaves it out.

`renderTranscript` takes a third argument, `TranscriptOptions`: with `onDock`, each surface is drawn in a card, `div.hai-dockable`, with that bar, and its Dock button calls `onDock` with the surface's handle, card and element. Without it, surfaces are drawn as before.
