/**
 * Built-in registry — the source of truth for `node:<name>` lookups.
 *
 * Split out from `index.ts` to break the cycle with `module.ts`, which needs
 * `listBuiltins()` to expose `Module.builtinModules` and would otherwise
 * import-cycle through `index.ts`.
 */

export type BuiltinFactory = () => Record<string, unknown>;

const cache: Map<string, Record<string, unknown>> = new Map();
const factories: Record<string, BuiltinFactory> = {};

/**
 * Higher-layer packages (net, etc.) call this to plug their Node-shape
 * exports into the loader so user code can `require('node:http')`. Keeping
 * the registration here decouples runtime-js from the higher layers — see
 * the layering rules in CLAUDE.md.
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
