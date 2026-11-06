import { defineSurface, resolve } from "@haikit/core";
import { z } from "zod";

/** What each server a user connects an account for is called, by its `mcpServer` name. */
export const ACCOUNTS: Record<string, string> = { notes: "Notes" };

export const Note = z.object({ id: z.string(), text: z.string(), createdAt: z.string() });
export type Note = z.infer<typeof Note>;

/** The user's notes, as Notes lists them. */
export const noteList = defineSurface({
  name: "note_list",
  version: 1,
  props: z.object({ account: z.string(), notes: z.array(Note) }),
});

/**
 * A note the model would save, shown for the user to save or discard. The
 * model has no tool that writes to Notes: only `decide`'s handler does, so a
 * note is saved only when the user clicks Save. One action, so the draft,
 * once answered, shows which they chose.
 */
export const noteDraft = defineSurface({
  name: "note_draft",
  version: 1,
  props: z.object({ text: z.string().min(1).max(500), account: z.string(), count: z.number() }),
  actions: {
    decide: resolve(z.enum(["save", "discard"])),
  },
});
