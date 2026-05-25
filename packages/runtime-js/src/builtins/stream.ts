/**
 * Re-export shim — stream primitives live in `@rifty/io` per ADR-0012.
 * Consumers that import this path (relative `./stream.ts` or
 * `@rifty/runtime-js/builtins`) continue to work bit-identically.
 */

import { Duplex, PassThrough, Readable, Transform, Writable, finished, pipeline } from '@rifty/io';

export {
  Readable,
  Writable,
  Duplex,
  Transform,
  PassThrough,
  pipeline,
  finished,
  type ReadableOptions,
  type WritableOptions,
  type TransformOptions,
} from '@rifty/io';

const stream = { Readable, Writable, Duplex, Transform, PassThrough, pipeline, finished };
export default stream;
