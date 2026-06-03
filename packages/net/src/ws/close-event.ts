/**
 * A `CloseEvent` constructor that works in every realm rifty supports.
 *
 * Browsers and Node ≥23 expose `CloseEvent` as a global, but Node 22 — which we
 * still support (`engines.node: ">=22"`) — exposes only `Event` / `EventTarget`,
 * so a bare `new CloseEvent(...)` throws `ReferenceError: CloseEvent is not
 * defined` under a `node` test environment. We use the native constructor when
 * present and a faithful `Event` subclass (carrying `code` / `reason` /
 * `wasClean`) otherwise, so the dispatched `'close'` event reads the same on
 * either path.
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
