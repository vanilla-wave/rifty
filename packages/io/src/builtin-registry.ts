/**
 * Built-in registry — the source of truth for `node:<name>` lookups.
 *
 * Lives in `@rifty/io` (per ADR-0035) so higher layers can register their
 * Node-shape exports via a forward import. `@rifty/runtime-js` calls
 * `loadBuiltin` from its module loader; `@rifty/net` calls `registerBuiltin`
 * from its side-effect entrypoint. Both depend on `@rifty/io`, so the layer
 * direction stays top-down.
 *
 * The registry is a process-wide singleton: one `factories` map and one
 * `cache` map per realm. Re-registering the same name discards the cached
 * namespace so the next `loadBuiltin` call calls the new factory.
 */

export type BuiltinFactory = () => Record<string, unknown>;

const cache: Map<string, Record<string, unknown>> = new Map();
const factories: Record<string, BuiltinFactory> = {};

/**
 * Higher-layer packages (`@rifty/net`, future `@rifty/wasi` builtins, etc.)
 * call this to plug their Node-shape exports into the loader so user code
 * can `require('node:http')`. Keeping the registry here decouples
 * `@rifty/runtime-js` from those higher layers — see the layering rules in
 * CLAUDE.md and the rationale in ADR-0035.
 */
export function registerBuiltin(name: string, factory: BuiltinFactory): void {
  factories[name] = factory;
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
  const ns = factory();
  cache.set(name, ns);
  return ns;
}

export function listBuiltins(): string[] {
  return Object.keys(factories);
}
