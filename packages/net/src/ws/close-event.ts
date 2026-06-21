/**
 * A `CloseEvent` constructor that works in every realm rifty supports.
 *
 * Browsers and Node ≥23 expose `CloseEvent` as a global; every realm rifty now targets
 * (the browser runtime + Node ≥24 for tests, `engines.node: ">=24"`) has it. The fallback
 * `Event` subclass (carrying `code` / `reason` / `wasClean`) is kept as a defensive guard
 * for any realm that doesn't expose the global, so the dispatched `'close'` event reads the
 * same on either path. We use the native constructor when present, the fallback otherwise.
 */
export interface CloseEventInitLike {
  code?: number;
  reason?: string;
  wasClean?: boolean;
}

type CloseEventLikeCtor = new (type: string, init?: CloseEventInitLike) => Event;

class CloseEventFallback extends Event {
  readonly code: number;
  readonly reason: string;
  readonly wasClean: boolean;
  constructor(type: string, init: CloseEventInitLike = {}) {
    super(type);
    this.code = init.code ?? 0;
    this.reason = init.reason ?? '';
    this.wasClean = init.wasClean ?? false;
  }
}

export const CloseEventCtor: CloseEventLikeCtor =
  (globalThis as { CloseEvent?: CloseEventLikeCtor }).CloseEvent ?? CloseEventFallback;
