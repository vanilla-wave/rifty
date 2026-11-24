/**
 * Node-compatible `node:stream.Transform` — owned by `@riftydev/io` per ADR-0012.
 *
 * Node's model: `transform`/`flush` options become own `_transform`/`_flush`;
 * `Transform.prototype._write` runs `this._transform` and `_final` runs
 * `this._flush`, each looked up at call time, so subclass prototypes work.
 */

import {
  type CallableStreamConstructor,
  makeCallableStreamConstructor,
} from './callable-constructor.ts';
import { Duplex, type DuplexOptions } from './duplex.ts';
import { methodNotImplementedError } from './method-not-implemented.ts';

type TransformCallback = (err?: Error | null, value?: unknown) => void;

export interface TransformOptions extends DuplexOptions {
  transform?(this: Transform, chunk: unknown, encoding: string, cb: TransformCallback): void;
  flush?(this: Transform, cb: TransformCallback): void;
}

/** Node's `final`: flush, push EOF. Identity matters — see {@link prefinish}. */
function final(this: Transform, cb?: (err?: Error | null) => void): void {
  if (typeof this._flush !== 'function' || this.destroyed) {
    this.push(null);
    cb?.();
    return;
  }
  this._flush((err, value) => {
    if (err) {
      if (cb) cb(err);
      else this.destroy(err);
      return;
    }
    if (value != null) this.push(value);
    this.push(null);
    cb?.();
  });
}

/** A replaced `_final` still flushes once the writable side prefinishes (Node). */
function prefinish(this: Transform): void {
  if (this._final !== final) final.call(this);
}

function initializeTransform(receiver: Transform, opts: TransformOptions = {}): void {
  if (typeof opts.transform === 'function') receiver._transform = opts.transform;
  if (typeof opts.flush === 'function') receiver._flush = opts.flush;
  receiver.on('prefinish', prefinish);
}

class TransformImplementation extends Duplex {
  constructor(opts: TransformOptions = {}) {
    super(opts);
    initializeTransform(this as unknown as Transform, opts);
  }

  _transform(_chunk: unknown, _encoding: string, _cb: TransformCallback): void {
    throw methodNotImplementedError('_transform()');
  }

  override _write(chunk: unknown, encoding: string, cb: (err?: Error | null) => void): void {
    this._transform(chunk, encoding, (err, value) => {
      if (err) {
        cb(err);
        return;
      }
      if (value != null) this.push(value);
      cb();
    });
  }

  _flush?(cb: TransformCallback): void;

  /** Transform callbacks push the readable side; Node owns the same no-op hook. */
  override _read(): void {}
}

export interface Transform extends TransformImplementation {}

export type TransformConstructor = CallableStreamConstructor<
  typeof TransformImplementation,
  Transform,
  TransformOptions
>;

export const Transform: TransformConstructor = /* @__PURE__ */ makeCallableStreamConstructor(
  'Transform',
  TransformImplementation,
  (receiver, options) => {
    Duplex.call(receiver, options);
    initializeTransform(receiver, options);
  },
  () => ({ _final: final }),
);
