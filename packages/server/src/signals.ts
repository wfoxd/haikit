import type { Emit, StoreAdapter, WireEvent } from "@haikit/core";

/**
 * The channel signals and presence travel on between servers, through the
 * store's `publish` and `subscribe`. Those are keyed by conversation; this
 * name has a colon, which no conversation id a store issues has, so it can't
 * be mistaken for one.
 */
export const SIGNAL_CHANNEL = "haikit:signals";

type SignalEvent = Extract<WireEvent, { type: "signal" }>;

/**
 * What one Hai broadcasts, and who is watching: every open events stream in
 * this process, each signal's latest payload, and how many conversations have
 * a stream open, here and on the other servers sharing the store.
 */
export class Broadcast {
  /** Every events stream open in this process. */
  private readonly streams = new Set<Emit>();
  /** Each signal's latest payload, by name, for a stream that opens later. */
  private readonly latest = new Map<string, SignalEvent>();
  /** Conversations with a stream open here, and how many. */
  private readonly open = new Map<string, number>();
  /** Conversations whose last stream closed, still counted until the grace ends. */
  private readonly leaving = new Map<string, ReturnType<typeof setTimeout>>();
  /** The other servers' counts, by origin, with when each was last heard. */
  private readonly peers = new Map<string, { count: number; heard: number }>();
  private readonly listeners = new Set<(count: number) => void>();
  private total = 0;
  /** The local count other servers last heard from this one. */
  private told = 0;
  private started = false;
  /** Settles once this server hears the others: before then, what they send is missed. */
  private hearing: Promise<void> = Promise.resolve();
  /** A publish to the other servers in flight, and what waits behind it: the latest of each kind only. */
  private publishing = false;
  private readonly unsent = new Map<string, object>();
  readonly origin = globalThis.crypto.randomUUID();

  constructor(
    private readonly store: StoreAdapter,
    private readonly graceMs: number,
    private readonly heartbeatMs: number,
  ) {}

  /** Send a signal to every stream, here and on the other servers, and keep it for later ones. */
  send(event: SignalEvent) {
    this.latest.set(event.name, event);
    for (const send of this.streams) send(event);
    this.publish({ kind: "signal", event });
  }

  /**
   * An events stream opened for `conversationId`: it hears signals from now
   * on, starting with each one's latest payload, and the conversation counts
   * as present. Call what this returns when the stream closes.
   */
  opened(conversationId: string, emit: Emit): () => void {
    this.start();
    this.streams.add(emit);
    let closed = false;
    // Each signal's latest, once this server hears the others, so one they
    // sent is among them. A live one may come first; the latest is still the
    // latest, so at worst one arrives twice.
    void this.hearing.then(() => {
      if (!closed) for (const event of this.latest.values()) emit(event);
    });

    const wasLeaving = this.leaving.get(conversationId);
    if (wasLeaving !== undefined) {
      // back within the grace: it never stopped counting
      clearTimeout(wasLeaving);
      this.leaving.delete(conversationId);
    }
    const before = this.open.get(conversationId) ?? 0;
    this.open.set(conversationId, before + 1);
    if (before === 0 && wasLeaving === undefined) this.changed();

    return () => {
      if (closed) return;
      closed = true;
      this.streams.delete(emit);
      const left = (this.open.get(conversationId) ?? 1) - 1;
      if (left > 0) {
        this.open.set(conversationId, left);
        return;
      }
      this.open.delete(conversationId);
      // A browser that drops its stream reconnects within a second or two:
      // keep counting it a little longer, so the number doesn't flicker.
      const timer = setTimeout(() => {
        this.leaving.delete(conversationId);
        this.changed();
      }, this.graceMs);
      timer.unref?.();
      this.leaving.set(conversationId, timer);
    };
  }

  /** Hear the total now and whenever it changes. Returns a function that stops. */
  onPresence(listener: (count: number) => void): () => void {
    this.start();
    this.listeners.add(listener);
    listener(this.total);
    return () => void this.listeners.delete(listener);
  }

  /** Conversations with a stream open in this process, or within the grace. */
  private get local() {
    return this.open.size + this.leaving.size;
  }

  /**
   * Start hearing the other servers, and telling them this one's count, once.
   * A Hai that sends signals starts as it is created, so it has the others'
   * latest values before its first stream opens; any other, when one does.
   */
  start() {
    if (this.started) return;
    this.started = true;
    // For as long as this Hai lives. A store that can't listen still resolves,
    // and hears nothing: signals and presence then stay on this server.
    const subscribed = this.store.subscribe?.(SIGNAL_CHANNEL, (message) => this.hear(message), new AbortController().signal);
    if (subscribed) this.hearing = Promise.resolve(subscribed).catch(() => {});
    const beat = setInterval(() => this.beat(), this.heartbeatMs);
    beat.unref?.();
  }

  private hear(message: string) {
    let heard: { origin?: string; kind?: string; event?: SignalEvent; count?: number };
    try {
      heard = JSON.parse(message);
    } catch {
      return;
    }
    if (!heard || heard.origin === this.origin || typeof heard.origin !== "string") return;
    if (heard.kind === "signal" && heard.event?.type === "signal" && typeof heard.event.name === "string") {
      this.latest.set(heard.event.name, heard.event);
      for (const send of this.streams) send(heard.event);
    } else if (heard.kind === "presence" && Number.isSafeInteger(heard.count) && heard.count! >= 0) {
      // a count is a number of conversations: a whole number, never Infinity
      const known = this.peers.has(heard.origin);
      const count = heard.count!;
      if (count > 0) this.peers.set(heard.origin, { count, heard: Date.now() });
      else this.peers.delete(heard.origin);
      // a server it hadn't heard from yet hasn't heard from it either
      if (!known && count > 0 && this.local > 0) this.publish({ kind: "presence", count: this.local });
      this.recount();
    }
  }

  /** This server's count changed: tell the listeners, and the other servers. */
  private changed() {
    this.recount();
    if (this.local !== this.told) {
      this.told = this.local;
      this.publish({ kind: "presence", count: this.local });
    }
  }

  /** On a timer: drop servers gone quiet, and remind the others this one is here. */
  private beat() {
    this.recount();
    if (this.local > 0) this.publish({ kind: "presence", count: this.local });
  }

  private recount() {
    // three missed beats and a server's count no longer counts: it has gone
    const stale = Date.now() - 3 * this.heartbeatMs;
    let others = 0;
    for (const [origin, peer] of this.peers) {
      if (peer.heard < stale) this.peers.delete(origin);
      else others += peer.count;
    }
    const total = this.local + others;
    if (total === this.total) return;
    this.total = total;
    for (const listener of [...this.listeners]) {
      try {
        listener(total);
      } catch {
        // one listener's mistake doesn't stop the others hearing
      }
    }
  }

  /**
   * Tell the other servers. One publish is in flight at a time, and only the
   * latest of each signal, and of this server's count, waits behind it: a
   * burst of signals can't queue every obsolete payload in the store.
   */
  private publish(body: { kind: "signal"; event: SignalEvent } | { kind: "presence"; count: number }) {
    if (!this.store.publish) return;
    this.unsent.delete(body.kind === "signal" ? `signal:${body.event.name}` : "presence");
    this.unsent.set(body.kind === "signal" ? `signal:${body.event.name}` : "presence", body);
    if (!this.publishing) void this.flush();
  }

  private async flush() {
    this.publishing = true;
    while (this.unsent.size) {
      const [key, body] = this.unsent.entries().next().value!;
      this.unsent.delete(key);
      try {
        await this.store.publish!(SIGNAL_CHANNEL, JSON.stringify({ origin: this.origin, ...body }));
      } catch {
        // best effort: the other servers miss this one, and the next beat corrects presence
      }
    }
    this.publishing = false;
  }
}
