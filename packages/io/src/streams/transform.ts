/**
 * Node-compatible `node:stream.Transform` — owned by `@riftydev/io` per ADR-0012.
 *
 * Per ADR-0034, `write`/`end` live on the prototype — no per-instance rebinding.
 * If no `transform` option is given, chunks pass through unchanged.
 *
 * Writable-side impls are wired via the Symbol-keyed
 * {@link INTERNAL_WRITABLE_SIDE} hook on `Duplex`, avoiding instance-method
 * rebinding. The Symbol is intentionally not exported from `src/index.ts` —
 * subclasses outside `@riftydev/io` cannot reach it.
 */

import {
  Duplex,
  type DuplexInternalOptions,
  INTERNAL_WRITABLE_SIDE,
  ownFinalOverride,
  ownWriteOverride,
} from './duplex.ts';
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
    // `this` isn't available until super() returns, but the writable-side
    // factory only needs the ref at write-time — back-fill a ref-cell after super.
    const transformRef: { instance: Transform | null } = { instance: null };
    // The `Duplex` ctor type advertises only `ReadableOptions & WritableOptions`
    // but reads the `INTERNAL_WRITABLE_SIDE` symbol key internally; assemble both
    // into one bag. The symbol key is invisible to callers outside this package.
    const superOpts: ReadableOptions & WritableOptions & DuplexInternalOptions = {
      ...opts,
      [INTERNAL_WRITABLE_SIDE]: (innerOpts, owner) =>
        new Writable({
          ...innerOpts,
          write(chunk, encoding, cb): void {
            const t = transformRef.instance ?? (owner as Transform);
            if (!t) {
              cb(new Error('Transform stream not yet bound — internal invariant violated'));
              return;
            }
            const override = ownWriteOverride(t);
            if (override) {
              override.call(t, chunk, encoding, cb);
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
            const t = transformRef.instance ?? (owner as Transform);
            if (!t) {
              cb(new Error('Transform stream not yet bound — internal invariant violated'));
              return;
            }
            const override = ownFinalOverride(t);
            if (override) {
              override.call(t, cb);
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
    };
    super(superOpts);
    transformRef.instance = this;
  }
}
