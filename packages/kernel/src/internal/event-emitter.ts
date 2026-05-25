/**
 * Re-export shim — the EventEmitter implementation lives in `@rifty/io`
 * per ADR-0012. This file used to host a private subset; now both `io` and
 * `kernel` share the full Node-compatible class.
 *
 * Kept as a re-export so existing `import { EventEmitter } from './internal/event-emitter.ts'`
 * paths inside the kernel continue to work without churn.
 */

export { EventEmitter } from '@rifty/io';
