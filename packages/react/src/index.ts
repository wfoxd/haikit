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
import type { ComponentDef, SurfaceMode, SurfaceState } from "@haikit/client";
import type { ActionMap, Infer, QueryMap, Surface } from "@haikit/core";

type AnySurface = Surface<any, ActionMap, QueryMap>;
type PropsOf<S> = S extends Surface<infer P, any, any> ? P : never;
type ActionsOf<S> = S extends Surface<any, infer A, any> ? A : never;

/** What a React surface component receives, typed from its surface contract. */
export interface SurfaceProps<S extends AnySurface> {
  /** The surface's props, as its `props` schema produced them. */
  props: PropsOf<S>;
  /** `elicit` while the turn waits on this surface; `display` otherwise. */
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
      let selection: unknown;
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
      flushSync(draw);
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
