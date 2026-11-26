/**
 * The callback half of `fs`'s async APIs: Node validates the callback at the call
 * (`makeCallback`, `validateFunction(cb, 'cb')`) and delivers the outcome from the
 * request's completion (`fs-io-turn.ts`).
 */
import { invalidArgType } from '../internal/node-received.ts';
import { runNodeCallback } from './process-lifecycle-events.ts';

export type AnyCallback = (...args: never[]) => unknown;
type Delivered = (...args: unknown[]) => unknown;

/** Node's `makeCallback`: a callback that is not a function throws at the call. */
export function cbOf(cb: unknown, name = 'cb'): AnyCallback {
  if (typeof cb !== 'function') throw invalidArgType(`"${name}" argument`, 'of type function', cb);
  return cb as AnyCallback;
}

/** `[argument, callback]` of an optional-argument call: a function in its slot is the callback. */
export function optional(argOrCb: unknown, cb: unknown, name = 'cb'): [unknown, AnyCallback] {
  return typeof argOrCb === 'function'
    ? [undefined, cbOf(argOrCb, name)]
    : [argOrCb, cbOf(cb, name)];
}

/** `cb(null, value)` (`cb(null)` when `voided`) or `cb(error)` once `run` settles. */
export function deliver(cb: AnyCallback, run: Promise<unknown>, voided = false): void {
  const callback = cb as unknown as Delivered;
  run.then(
    (value) => (voided ? runNodeCallback(callback, null) : runNodeCallback(callback, null, value)),
    (error) => runNodeCallback(callback, error),
  );
}
