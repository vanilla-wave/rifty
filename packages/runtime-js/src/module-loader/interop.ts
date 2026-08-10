import type { ModuleRecord } from './registry.ts';

interface PrimedCjsNamespaceState {
  outer: unknown;
  hydrated: boolean;
  readonly namedValues: Map<string, unknown>;
}

const primedCjsNamespaces = new WeakMap<Record<string, unknown>, PrimedCjsNamespaceState>();

/**
 * Allocate the namespace identity needed during ESM instantiation without
 * executing the non-ESM module. Default/marker read undefined until hydration.
 */
export function primeCjsNamespace(
  kind: ModuleRecord['kind'],
  staticNames: ReadonlySet<string> = new Set(),
): Record<string, unknown> {
  const namespace: Record<string, unknown> = Object.create(null);
  const state: PrimedCjsNamespaceState = {
    outer: undefined,
    hydrated: false,
    namedValues: new Map(),
  };
  primedCjsNamespaces.set(namespace, state);
  Object.defineProperty(namespace, Symbol.toStringTag, { value: 'Module' });
  defineGetter(namespace, 'default', () => state.outer);
  if (kind === 'cjs') defineGetter(namespace, 'module.exports', () => state.outer);
  addStaticNames(namespace, state, kind, staticNames);
  return namespace;
}

/**
 * Return the ESM view owned by one non-ESM execution record. `default` is the
 * exact outer; file CJS also gets Node 23+'s `module.exports` marker (native
 * builtins do not). Named values snapshot when the namespace materialises.
 */
export function cjsNamespaceFor(
  record: ModuleRecord,
  primed?: Record<string, unknown>,
  staticNames: ReadonlySet<string> = new Set(),
): Record<string, unknown> {
  if (record.cjsNamespace) return record.cjsNamespace;

  const outer = record.exports;
  const namespace = primed ?? primeCjsNamespace(record.kind, staticNames);
  const state = primedCjsNamespaces.get(namespace);
  if (!state) throw new Error(`Invalid primed CJS namespace: ${record.id}`);
  if (state.hydrated) {
    if (record.state === 'loaded') record.cjsNamespace = namespace;
    return namespace;
  }
  addStaticNames(namespace, state, record.kind, staticNames);
  state.outer = outer;

  for (const name of state.namedValues.keys()) {
    let value: unknown;
    try {
      value = (outer as Record<string, unknown> | null | undefined)?.[name];
    } catch {
      value = undefined;
    }
    state.namedValues.set(name, value);
  }

  Object.preventExtensions(namespace);
  state.hydrated = true;
  if (record.state === 'loaded') record.cjsNamespace = namespace;
  return namespace;
}

function addStaticNames(
  namespace: Record<string, unknown>,
  state: PrimedCjsNamespaceState,
  kind: ModuleRecord['kind'],
  names: ReadonlySet<string>,
): void {
  for (const name of names) {
    if (name === 'default' || (kind === 'cjs' && name === 'module.exports')) continue;
    if (state.namedValues.has(name)) continue;
    state.namedValues.set(name, undefined);
    defineGetter(namespace, name, () => state.namedValues.get(name));
  }
}

function defineGetter(target: Record<string, unknown>, key: string, get: () => unknown): void {
  Object.defineProperty(target, key, { enumerable: true, get });
}
