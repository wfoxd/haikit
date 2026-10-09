/**
 * @haikit/react — write surface components in React.
 *
 *   function GreetingPicker({ props, send, state }: SurfaceProps<typeof greetingPicker>) { … }
 *   export const registry = { greeting_picker: reactSurface(GreetingPicker) };
 *
 * The client's contract is unchanged: a registry entry is something with a
 * `mount(element, props, ctx)`. This builds one around a React component, and
 * types it from the same `defineSurface` contract the server implements, so a
 * prop or an action that changes there stops this side compiling.
 */

import { createElement, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import type { ComponentDef, NoticeDef, SurfaceMode, SurfaceState } from "@haikit/client";
import type { ActionMap, Infer, Notice, QueryMap, Surface } from "@haikit/core";

type AnySurface = Surface<any, ActionMap, QueryMap>;
type PropsOf<S> = S extends Surface<infer P, any, any> ? P : never;
type ActionsOf<S> = S extends Surface<any, infer A, any> ? A : never;

/** What a React surface component receives, typed from its surface contract. */
export interface SurfaceProps<S extends AnySurface> {
  /** The surface's props, as its `props` schema produced them. */
  props: PropsOf<S>;
  /**
   * How the surface was opened: `elicit` as a question the turn waits on,
   * `display` as something shown. It doesn't change once the question is
   * answered; `state` does.
   */
  mode: SurfaceMode;
  /** `frozen` once answered: a resolved question cannot be answered again. */
  state: SurfaceState;
  /** What the user picked, once the surface is frozen. */
  selection?: unknown;
  /** The conversation is out of date: nothing here can reach the server again. */
  expired: boolean;
  /**
   * The only channel to the server: an action the contract declares, with a
   * value of its input type. Never a tool, never a handler.
   */
  send<K extends keyof ActionsOf<S> & string>(action: K, value: Infer<ActionsOf<S>[K]["input"]>): Promise<void>;
}

/**
 * A registry entry that renders `Component` into the surface's element.
 *
 * The first render is synchronous, so the surface has its height when the
 * transcript scrolls to it; later ones are React's. It re-renders when the
 * surface freezes or the conversation goes out of date, and its root is
 * unmounted when the surface goes away, so effects clean up after themselves.
 */
export function reactSurface<S extends AnySurface>(Component: ComponentType<SurfaceProps<S>>): ComponentDef<PropsOf<S>> {
  return {
    mount(element, props, ctx) {
      const root = createRoot(element);
      let state = ctx.state;
      // set when it is mounted already frozen
      let selection = ctx.selection;
      let expired = false;
      const draw = () =>
        root.render(
          createElement(Component, {
            props,
            mode: ctx.mode,
            state,
            selection,
            expired,
            send: ctx.send as SurfaceProps<S>["send"],
          }),
        );
      // A component that throws on its first render leaves no instance behind
      // to unmount later, so its root is let go of here, before the error goes
      // on; otherwise a remount would stack a second root on this element.
      try {
        flushSync(draw);
      } catch (err) {
        root.unmount();
        throw err;
      }
      return {
        freeze(picked) {
          state = "frozen";
          selection = picked;
          draw();
        },
        expire() {
          expired = true;
          draw();
        },
        unmount() {
          root.unmount();
        },
      };
    },
  };
}

// any kind: a wake notice renders as a passive one does
type AnyNotice = Notice<any, any>;
type PayloadOf<N> = N extends Notice<infer P, any> ? P : never;

/** What a React notice component receives, typed from its notice contract. */
export interface NoticeProps<N extends AnyNotice> {
  /** The notice's payload, as its `payload` schema produced it. */
  payload: PayloadOf<N>;
  /** Its sequence number in the conversation. */
  seq: number;
  /** The surface it is shown beside, if any. */
  handle?: string;
}

/**
 * A notices registry entry that renders `Component` into the notice's element.
 * As with `reactSurface`, the first render is synchronous and the root is
 * unmounted when the notice goes away. A notice has no `send`.
 */
export function reactNotice<N extends AnyNotice>(Component: ComponentType<NoticeProps<N>>): NoticeDef<PayloadOf<N>> {
  return {
    mount(element, payload, ctx) {
      const root = createRoot(element);
      try {
        flushSync(() => root.render(createElement(Component, { payload, seq: ctx.seq, handle: ctx.handle })));
      } catch (err) {
        root.unmount();
        throw err;
      }
      return {
        unmount() {
          root.unmount();
        },
      };
    },
  };
}
