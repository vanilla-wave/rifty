/**
 * Re-export shim — the Buffer polyfill lives in `@riftydev/io` per ADR-0012.
 * Consumers that import this path (relative `./buffer.ts` or
 * `@riftydev/runtime-js/builtins`) continue to work bit-identically.
 */

import { Buffer } from '@riftydev/io';

export { Buffer, type BufferLike, type Encoding } from '@riftydev/io';
export default { Buffer };
