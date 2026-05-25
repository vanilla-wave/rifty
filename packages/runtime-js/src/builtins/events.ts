/**
 * Re-export shim — the EventEmitter implementation lives in `@rifty/io`
 * per ADR-0012. Consumers that import this path (relative `./events.ts` or
 * `@rifty/runtime-js/builtins`) continue to work bit-identically.
 */

import { EventEmitter } from '@rifty/io';

export { EventEmitter, once } from '@rifty/io';
export default EventEmitter;
