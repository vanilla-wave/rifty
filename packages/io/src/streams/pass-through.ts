/**
 * Node-compatible `node:stream.PassThrough` — owned by `@rifty/io` per ADR-0012.
 *
 * Trivial Transform with an identity transform; chunks in == chunks out.
 */

import { Transform, type TransformOptions } from './transform.ts';

export class PassThrough extends Transform {
  constructor(opts: TransformOptions = {}) {
    super({
      ...opts,
      transform(chunk, _encoding, cb) {
        cb(null, chunk);
      },
    });
  }
}
