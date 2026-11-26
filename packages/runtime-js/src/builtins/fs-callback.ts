/**
 * The callback half of `fs`'s async APIs: Node validates the callback at the call
 * (`makeCallback`, `validateFunction(cb, 'cb')`) and delivers the outcome from the
 * request's completion (`fs-io-turn.ts`).
 */
import { invalidArgType } from '../internal/node-received.ts';
import { optionsAtCall } from './fs-io-turn.ts';
import { runNodeCallback } from './process-lifecycle-events.ts';

export type AnyCallback = (...args: never[]) => unknown;
type Delivered = (...args: unknown[]) => unknown;

/** Node's `makeCallback`: a callback that is not a function throws at the call. */
export function cbOf(cb: unknown, name = 'cb'): AnyCallback {
  if (typeof cb !== 'function') throw invalidArgType(`"${name}" argument`, 'of type function', cb);
  return cb as AnyCallback;
}

/** `[options, callback]` of an optional-options call: a function in the options slot is the callback. */
export function optional(optsOrCb: unknown, cb: unknown, name = 'cb'): [unknown, AnyCallback] {
  return typeof optsOrCb === 'function'
    ? [undefined, cbOf(optsOrCb, name)]
    : [optionsAtCall(optsOrCb), cbOf(cb, name)];
}

/** Node's `callback ||= options` (`readFile`, `writeFile`, `appendFile`). */
export function orOptions(optsOrCb: unknown, cb: unknown): [unknown, AnyCallback] {
  return [
    typeof optsOrCb === 'function' ? undefined : optionsAtCall(optsOrCb),
    cbOf(cb || optsOrCb),
  ];
}

/** `cb(null, value)` (`cb(null)` when `voided`) or `cb(error)` once `run` settles. */
export function deliver(cb: AnyCallback, run: Promise<unknown>, voided = false): void {
  const callback = cb as unknown as Delivered;
  run.then(
    (value) => (voided ? runNodeCallback(callback, null) : runNodeCallback(callback, null, value)),
    (error) => runNodeCallback(callback, error),
  );
}
