/**
 * Aggregator for the split stream primitives. The runtime-js `node:stream`
 * adapter pulls its `default` export (object shape) from here.
 */

import { Duplex } from './duplex.ts';
import { PassThrough } from './pass-through.ts';
import { finished, pipeline } from './pipeline.ts';
import { Readable } from './readable.ts';
import { Transform } from './transform.ts';
import { Writable } from './writable.ts';

export { Readable, type ReadableOptions } from './readable.ts';
export { Writable, type WritableOptions } from './writable.ts';
export { Duplex } from './duplex.ts';
export { Transform, type TransformOptions } from './transform.ts';
export { PassThrough } from './pass-through.ts';
export { pipeline, finished } from './pipeline.ts';

const stream = { Readable, Writable, Duplex, Transform, PassThrough, pipeline, finished };
export default stream;
