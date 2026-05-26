/**
 * Node-compatible `node:stream.Transform` — owned by `@rifty/io` per ADR-0012.
 *
 * Per ADR-0034, `Transform.prototype.write` / `Transform.prototype.end` live
 * on the prototype — there is NO per-instance method rebinding. The transform
 * pipeline is:
 *
 *   1. `write(chunk)` enters via the prototype method (inherited from Duplex).
 *   2. The Transform's `_transform(chunk, enc, cb)` is invoked with a callback
 *      that pushes `value` to the readable side and signals consumption.
 *   3. `end()` schedules `_flush(cb)` (if provided), then `push(null)`.
 *
 * Identity-default: if no `transform` option is given, the chunk passes
 * through unchanged.
 *
 * The writable-side impls are wired via the protected `_internalWritableSide`
 * factory hook on `Duplex` so that no instance-method rebinding is needed.
 */

import { Duplex } from './duplex.ts';
import type { ReadableOptions } from './readable.ts';
import { Writable, type WritableOptions } from './writable.ts';

export interface TransformOptions extends ReadableOptions, WritableOptions {
  transform?(
    this: Transform,
    chunk: unknown,
    encoding: string,
    cb: (err?: Error | null, value?: unknown) => void,
  ): void;
  flush?(this: Transform, cb: (err?: Error | null) => void): void;
}

export class Transform extends Duplex {
  constructor(opts: TransformOptions = {}) {
    const transformImpl = opts.transform;
    const flushImpl = opts.flush;
    // `transform` instance is constructed after `super(...)` returns, but the
    // writable-side factory only needs a reference at write-time. We capture
    // a ref-cell that we'll back-fill after the super call. This avoids
    // post-construction Object.assign churn and keeps the writable-side
    // factory pure.
    const transformRef: { instance: Transform | null } = { instance: null };
    super({
      ...opts,
      _internalWritableSide: (innerOpts) =>
        new Writable({
          ...innerOpts,
          write(chunk, encoding, cb): void {
            const t = transformRef.instance;
            if (!t) {
              cb(new Error('Transform stream not yet bound — internal invariant violated'));
              return;
            }
            if (transformImpl) {
              transformImpl.call(t, chunk, encoding, (err, value) => {
                if (err) {
                  cb(err);
                  return;
                }
                if (value !== undefined && value !== null) t.push(value);
                cb();
              });
              return;
            }
            // Identity-default: echo to readable side.
            t.push(chunk);
            cb();
          },
          final(cb): void {
            const t = transformRef.instance;
            if (!t) {
              cb(new Error('Transform stream not yet bound — internal invariant violated'));
              return;
            }
            const finalize = (): void => {
              t.push(null);
              cb();
            };
            if (flushImpl) {
              flushImpl.call(t, (err) => {
                if (err) cb(err);
                else finalize();
              });
              return;
            }
            finalize();
          },
        }),
    });
    transformRef.instance = this;
  }
}
