/**
 * Node-compatible `node:stream.PassThrough` — owned by `@riftydev/io` per ADR-0012.
 *
 * Trivial Transform with an identity transform; chunks in == chunks out.
 */

import {
  type CallableStreamConstructor,
  makeCallableStreamConstructor,
} from './callable-constructor.ts';
import { Transform, type TransformOptions } from './transform.ts';

function passThroughOptions(opts: TransformOptions = {}): TransformOptions {
  return {
    ...opts,
    transform(chunk, _encoding, cb) {
      cb(null, chunk);
    },
  };
}

class PassThroughImplementation extends Transform {
  constructor(opts: TransformOptions = {}) {
    super(passThroughOptions(opts));
  }
}

export interface PassThrough extends PassThroughImplementation {}

export type PassThroughConstructor = CallableStreamConstructor<
  typeof PassThroughImplementation,
  PassThrough,
  TransformOptions
>;

export const PassThrough: PassThroughConstructor = makeCallableStreamConstructor(
  'PassThrough',
  PassThroughImplementation,
  (receiver, options) => {
    Transform.call(receiver, passThroughOptions(options));
  },
);
