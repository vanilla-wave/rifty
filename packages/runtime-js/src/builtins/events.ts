/**
 * Re-export shim — the EventEmitter implementation lives in `@riftydev/io`
 * per ADR-0012. Consumers that import this path (relative `./events.ts` or
 * `@riftydev/runtime-js/builtins`) continue to work bit-identically.
 */

import { EventEmitter } from '@riftydev/io';

export { EventEmitter, once } from '@riftydev/io';
export default EventEmitter;
