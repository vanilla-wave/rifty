/**
 * Node-compatible `node:stream.PassThrough` — owned by `@riftydev/io` per ADR-0012.
 *
 * Trivial Transform with an identity transform; chunks in == chunks out.
 * The identity lives on the PROTOTYPE like Node's — so a `transform` option
 * (instance) shadows it and a subclass `_transform` overrides it (probed
 * v24.16.0), instead of an option-injected identity that would win over both.
 */

import { Transform, type TransformOptions } from './transform.ts';

export class PassThrough extends Transform {
  constructor(opts: TransformOptions = {}) {
    super(opts);
  }

  override _transform(
    chunk: unknown,
    _encoding: string,
    cb: (err?: Error | null, value?: unknown) => void,
  ): void {
    cb(null, chunk);
  }
}
