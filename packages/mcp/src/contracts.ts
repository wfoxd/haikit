import { defineNotice, defineSurface, type Notice, type Surface } from "@haikit/core";
import { isMcpError, type McpAuthNeed } from "./errors.js";

/**
 * The contracts for asking a user to connect an account and for hearing
 * they have. They are declarations only, imported by both halves as a
 * surface's are: the server implements each with its own words for the
 * model, and the browser renders each with its own component. Neither half
 * may add to them, so an app that needs other props declares its own.
 *
 * In the browser, import them as types only: this package's entry runs on
 * Node.
 */

/** The connect card's props. */
export interface ConnectCardProps {
  /** The server's `name`, as on the error's `server`. */
  server: string;
  /** What the user calls it, such as `GitHub`, for the card's words. */
  label: string;
  /** The error's `auth.kind`: connect, connect again, or give more access. */
  need: McpAuthNeed["kind"];
  /** The error's `auth.connect`: a path on this app, for the browser alone. Never in the digest. */
  href: string;
}

const NEEDS: ReadonlyArray<string> = ["connect", "reconnect", "scope"];
/** Two, so an href naming a host can't pass by naming the one it's checked against. */
const SOMEWHERE = ["http://a.haikit.invalid", "http://b.haikit.invalid"];

const named = (value: unknown): value is string => typeof value === "string" && value !== "";

/**
 * A path on this app: starts with one `/`, and stays on whichever origin
 * it's resolved against. So not `//evil.example`, and not `/\evil.example`
 * or a tab after the slash, which a browser reads the same way: those keep
 * their own host, whatever the base.
 */
function onThisApp(href: string): boolean {
  if (!href.startsWith("/")) return false;
  try {
    return SOMEWHERE.every((base) => new URL(href, base).origin === base);
  } catch {
    return false;
  }
}

/**
 * Asks the user to connect an account, from an `auth` error's `auth`, as
 * {@link connectCardFor} makes its props. A display surface with no actions:
 * the tool returns at once, the turn goes on, and the user connects whenever
 * they like, in a popup or another tab. The {@link accountConnected} notice
 * tells the conversation once they have.
 *
 * Its messages never quote a prop, since a tool that lets one through
 * reaches the model as `<tool> failed: <message>`, and `href` isn't for the
 * model.
 */
export const connectCard: Surface<ConnectCardProps, {}, {}> = defineSurface({
  name: "connect_card",
  version: 1,
  props: {
    parse(value: unknown): ConnectCardProps {
      if (typeof value !== "object" || value === null) throw new TypeError("connect_card: props must be an object");
      const { server, label, need, href } = value as Record<string, unknown>;
      if (!named(server)) throw new TypeError("connect_card: server must be a non-empty string");
      if (!named(label)) throw new TypeError("connect_card: label must be a non-empty string");
      if (typeof need !== "string" || !NEEDS.includes(need)) throw new TypeError('connect_card: need must be "connect", "reconnect" or "scope"');
      if (typeof href !== "string" || !onThisApp(href)) throw new TypeError("connect_card: href must be a path on this app, such as err.auth.connect");
      return { server, label, need: need as ConnectCardProps["need"], href };
    },
  },
});

/**
 * The user connected an account, from a link that named this conversation:
 * the conversation `onConnected` is told. A wake notice, so the model hears
 * it at once, and can call the tool that needed the account again.
 */
export const accountConnected: Notice<{ server: string }, "wake"> = defineNotice({
  name: "account_connected",
  version: 1,
  kind: "wake",
  payload: {
    parse(value: unknown): { server: string } {
      const server = typeof value === "object" && value !== null ? (value as Record<string, unknown>).server : undefined;
      if (!named(server)) throw new TypeError("account_connected: server must be a non-empty string");
      return { server };
    },
  },
});

/**
 * The connect card's props for a call that needs the user to connect, or
 * `null` for any other error. Only an `oauth()` server's `auth` error has a
 * link to connect at, so one from `bearer()` or `sdk()` is `null` too.
 * `label` is what the card calls the server, the server's `name` if absent.
 */
export function connectCardFor(err: unknown, label?: string): ConnectCardProps | null {
  if (!isMcpError(err) || err.reason !== "auth" || !err.auth?.connect) return null;
  return { server: err.server, label: label ?? err.server, need: err.auth.kind, href: err.auth.connect };
}
