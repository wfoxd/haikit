/**
 * What people who signed in with Google or GitHub are called, by user id:
 * theirs is `google:` or `github:` and a number, which is no way to greet
 * anyone. A real app keeps this in its users table. This map forgets on a
 * restart, and `welcome` then says the id.
 */
export const names = new Map<string, string>();
