/**
 * Re-export shim — the EventEmitter implementation lives in `@riftydev/io`
 * per ADR-0012. Consumers that import this path (relative `./events.ts` or
 * `@riftydev/runtime-js/builtins`) continue to work bit-identically.
 */

import { EventEmitter } from '@riftydev/io';

export { EventEmitter, once } from '@riftydev/io';
export default EventEmitter;

/**
 * Node shares one function per alias pair (`on = addListener`, `off =
 * removeListener`), as its Readable does over its own overrides. A builtin
 * subclass overriding a canonical name re-aliases after its class body, so
 * calls through either name reach the override.
 */
export function aliasListenerOverrides(prototype: EventEmitter): void {
  const pairs = [
    ['on', 'addListener'],
    ['off', 'removeListener'],
  ] as const;
  for (const [alias, name] of pairs) {
    Object.defineProperty(prototype, alias, {
      configurable: true,
      writable: true,
      value: prototype[name],
    });
  }
}
