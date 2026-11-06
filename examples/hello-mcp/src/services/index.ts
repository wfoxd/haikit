import { startAlmanac } from "./almanac.ts";
import { startCalendar } from "./calendar.ts";
import { startNotes } from "./notes.ts";

// The three services the app calls, started in this process so it runs
// offline. Each is someone else's in a real app: the app knows each only by
// its URL, and the key or sign-in it takes.
export const notesService = await startNotes();
export const calendarService = await startCalendar();
export const almanacService = await startAlmanac();
