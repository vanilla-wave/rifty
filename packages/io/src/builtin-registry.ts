/**
 * Built-in registry — source of truth for `node:<name>` lookups.
 *
 * Lives in `@riftydev/io` (ADR-0035) so higher layers register their
 * Node-shape exports via a forward import, keeping the layer direction
 * top-down: `@riftydev/runtime-js` calls `loadBuiltin`, `@riftydev/net` calls
 * `registerBuiltin`, both depend on `@riftydev/io`.
 *
 * Process-wide singleton. Re-registering a name discards its cached namespace
 * so the next `loadBuiltin` invokes the new factory.
 */

export type BuiltinFactory<T = unknown> = () => T;

const cache: Map<string, Record<string, unknown>> = new Map();
const factories: Record<string, BuiltinFactory<unknown>> = {};

/**
 * Plug a higher-layer package's Node-shape exports into the loader so user code
 * can `require('node:http')`. Keeping the registry here decouples
 * `@riftydev/runtime-js` from those layers (ADR-0035).
 *
 * Generic over the return type so registration sites keep the concrete module
 * shape and TS catches typos. Storage erases to `BuiltinFactory<unknown>`;
 * `loadBuiltin` returns `Record<string, unknown> | null`, so callers project
 * the namespace at the boundary.
 */
export function registerBuiltin<T>(name: string, factory: BuiltinFactory<T>): void {
  factories[name] = factory as BuiltinFactory<unknown>;
  cache.delete(name);
}

export function isBuiltinSpecifier(specifier: string): boolean {
  const name = specifier.startsWith('node:') ? specifier.slice(5) : specifier;
  return name in factories;
}

export function loadBuiltin(specifier: string): Record<string, unknown> | null {
  const name = specifier.startsWith('node:') ? specifier.slice(5) : specifier;
  const cached = cache.get(name);
  if (cached) return cached;
  const factory = factories[name];
  if (!factory) return null;
  const ns = factory() as Record<string, unknown>;
  cache.set(name, ns);
  return ns;
}

export function listBuiltins(): string[] {
  return Object.keys(factories);
}
