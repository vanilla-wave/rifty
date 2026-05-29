/**
 * Re-export shim — stream primitives live in `@rifty/io` per ADR-0012.
 * Consumers that import this path (relative `./stream.ts` or
 * `@rifty/runtime-js/builtins`) continue to work bit-identically.
 */

import {
  Duplex,
  PassThrough,
  Readable,
  Stream,
  Transform,
  Writable,
  finished,
  pipeline,
} from '@rifty/io';

export {
  Readable,
  Writable,
  Duplex,
  Transform,
  PassThrough,
  Stream,
  pipeline,
  finished,
  type ReadableOptions,
  type WritableOptions,
  type TransformOptions,
} from '@rifty/io';

// `require('stream')` in Node IS the legacy `Stream` constructor with the
// modern classes attached as statics (and `Stream.Stream === Stream`). Match
// that shape so `util.inherits(X, require('stream'))` works (e.g. `send`).
const stream = Object.assign(Stream, {
  Readable,
  Writable,
  Duplex,
  Transform,
  PassThrough,
  pipeline,
  finished,
  Stream,
});
export default stream;
