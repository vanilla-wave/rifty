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
  type CallableStreamConstructor,
  makeCallableStreamConstructor,
} from './callable-constructor.ts';
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

const TRANSFORM_HOOK = Symbol('rifty/io:transform-hook');
const FLUSH_HOOK = Symbol('rifty/io:transform-flush-hook');

interface TransformHookTarget {
  [TRANSFORM_HOOK]?: NonNullable<TransformOptions['transform']>;
  [FLUSH_HOOK]?: NonNullable<TransformOptions['flush']>;
}

interface TransformConstruction {
  readonly options: ReadableOptions & WritableOptions & DuplexInternalOptions;
  bind(instance: Transform): void;
}

function prepareTransform(
  opts: TransformOptions = {},
  receiver?: Transform,
): TransformConstruction {
  const target = receiver as (Transform & TransformHookTarget) | undefined;
  const configuredTransform = opts.transform;
  const configuredFlush = opts.flush;
  const transformImpl =
    typeof configuredTransform === 'function' ? configuredTransform : target?.[TRANSFORM_HOOK];
  const flushImpl = typeof configuredFlush === 'function' ? configuredFlush : target?.[FLUSH_HOOK];
  const transformRef: { instance: Transform | null } = { instance: null };
  return {
    options: {
      ...opts,
      [INTERNAL_WRITABLE_SIDE]: (innerOpts, owner) =>
        new Writable({
          ...innerOpts,
          write(chunk, encoding, cb): void {
            const target = transformRef.instance ?? (owner as Transform);
            const override = ownWriteOverride(target);
            if (override) {
              override.call(target, chunk, encoding, cb);
              return;
            }
            if (transformImpl) {
              transformImpl.call(target, chunk, encoding, (err, value) => {
                if (err) cb(err);
                else {
                  if (value !== undefined && value !== null) target.push(value);
                  cb();
                }
              });
              return;
            }
            target.push(chunk);
            cb();
          },
          final(cb): void {
            const target = transformRef.instance ?? (owner as Transform);
            const override = ownFinalOverride(target);
            if (override) {
              override.call(target, cb);
              return;
            }
            const finalize = (): void => {
              target.push(null);
              cb();
            };
            if (flushImpl) {
              flushImpl.call(target, (err) => {
                if (err) cb(err);
                else finalize();
              });
            } else finalize();
          },
        }),
    },
    bind(instance): void {
      transformRef.instance = instance;
      const bound = instance as Transform & TransformHookTarget;
      if (typeof configuredTransform === 'function') bound[TRANSFORM_HOOK] = configuredTransform;
      if (typeof configuredFlush === 'function') bound[FLUSH_HOOK] = configuredFlush;
    },
  };
}

class TransformImplementation extends Duplex {
  constructor(opts: TransformOptions = {}) {
    const construction = prepareTransform(opts);
    super(construction.options);
    construction.bind(this as unknown as Transform);
  }

  /** Transform callbacks push the readable side; Node owns the same no-op hook. */
  override _read(): void {}
}

export interface Transform extends TransformImplementation {}

export type TransformConstructor = CallableStreamConstructor<
  typeof TransformImplementation,
  Transform,
  TransformOptions
>;

export const Transform: TransformConstructor = makeCallableStreamConstructor(
  'Transform',
  TransformImplementation,
  (receiver, options) => {
    const construction = prepareTransform(options, receiver);
    Duplex.call(receiver, construction.options);
    construction.bind(receiver);
  },
);
