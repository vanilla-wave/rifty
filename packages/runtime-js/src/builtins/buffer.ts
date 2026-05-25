/**
 * Re-export shim — the Buffer polyfill lives in `@rifty/io` per ADR-0012.
 * Consumers that import this path (relative `./buffer.ts` or
 * `@rifty/runtime-js/builtins`) continue to work bit-identically.
 */

import { Buffer } from '@rifty/io';

export { Buffer, type BufferLike, type Encoding } from '@rifty/io';
export default { Buffer };
