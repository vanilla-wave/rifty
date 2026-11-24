/**
 * Node-compatible `node:stream.PassThrough` — owned by `@riftydev/io` per ADR-0012.
 *
 * Transform whose prototype `_transform` is the identity; a `transform` option still wins (Node).
 */

import {
  type CallableStreamConstructor,
  makeCallableStreamConstructor,
} from './callable-constructor.ts';
import { Transform, type TransformOptions } from './transform.ts';

class PassThroughImplementation extends Transform {
  override _transform(
    chunk: unknown,
    _encoding: string,
    cb: (err?: Error | null, value?: unknown) => void,
  ): void {
    cb(null, chunk);
  }
}

export interface PassThrough extends PassThroughImplementation {}

export type PassThroughConstructor = CallableStreamConstructor<
  typeof PassThroughImplementation,
  PassThrough,
  TransformOptions
>;

export const PassThrough: PassThroughConstructor = /* @__PURE__ */ makeCallableStreamConstructor(
  'PassThrough',
  PassThroughImplementation,
  (receiver, options) => {
    Transform.call(receiver, options);
  },
);
