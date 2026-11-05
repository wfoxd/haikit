import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/** The shortest secret that seals, in bytes. */
export const SECRET_BYTES = 32;
const INFO = "haikit/mcp credentials";
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** Marks the format, so another can follow it. */
const PREFIX = "v1.";

/**
 * What a sealed value is bound to: the row it's kept in. A value copied to
 * another row doesn't open there, as another user's credential, another
 * server's client, or another flow.
 */
export const binding = {
  credential: (userId: string, server: string) => JSON.stringify(["credential", userId, server]),
  client: (server: string, issuer: string) => JSON.stringify(["client", server, issuer]),
  flow: (state: string) => JSON.stringify(["flow", state]),
};

/**
 * AES-256-GCM, with a key from each secret by HKDF-SHA256. The first secret
 * seals, and every one opens, so a secret can be rotated out: add the new one
 * first, and drop the old once nothing sealed with it is kept.
 */
export class Sealer {
  private readonly keys: Buffer[];

  constructor(secrets: readonly string[]) {
    this.keys = secrets.map((secret) => Buffer.from(hkdfSync("sha256", secret, new Uint8Array(0), INFO, 32)));
  }

  seal(value: unknown, bound: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.keys[0], iv);
    cipher.setAAD(Buffer.from(bound));
    const sealed = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), sealed]).toString("base64url");
  }

  /** What `seal` was given, if one of the secrets sealed it for `bound`; else null. */
  open(sealed: string, bound: string): unknown {
    if (typeof sealed !== "string" || !sealed.startsWith(PREFIX)) return null;
    const bytes = Buffer.from(sealed.slice(PREFIX.length), "base64url");
    if (bytes.length < IV_BYTES + TAG_BYTES) return null;
    const iv = bytes.subarray(0, IV_BYTES);
    const tag = bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const body = bytes.subarray(IV_BYTES + TAG_BYTES);
    for (const key of this.keys) {
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAAD(Buffer.from(bound));
        decipher.setAuthTag(tag);
        return JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8"));
      } catch {
        // sealed with another secret, or for another row: the next secret may open it
      }
    }
    return null;
  }
}
