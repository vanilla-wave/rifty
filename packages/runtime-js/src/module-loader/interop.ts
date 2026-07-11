import type { ModuleRecord } from './registry.ts';

/**
 * Return the ESM view owned by one non-ESM execution record. `default` is the
 * exact outer; file CJS also gets Node 23+'s `module.exports` marker (native
 * builtins do not). Named values snapshot when the namespace materialises.
 */
export function cjsNamespaceFor(record: ModuleRecord): Record<string, unknown> {
  if (record.cjsNamespace) return record.cjsNamespace;

  const outer = record.exports;
  const namespace: Record<string, unknown> = Object.create(null);
  Object.defineProperty(namespace, Symbol.toStringTag, { value: 'Module' });
  defineSnapshot(namespace, 'default', outer);
  if (record.kind === 'cjs') defineSnapshot(namespace, 'module.exports', outer);

  if (outer !== null && (typeof outer === 'object' || typeof outer === 'function')) {
    // TODO(backlog: runtime-js/cjs-esm-static-named-exports): Node discovers
    // names from CJS source; runtime enumeration is honest but not that lexer.
    let keys: string[];
    try {
      keys = Object.keys(outer);
    } catch {
      // Named discovery is optional; hostile reflection must not suppress the
      // exact default/marker that Node still exposes.
      keys = [];
    }
    for (const key of keys) {
      if (key === 'default' || (record.kind === 'cjs' && key === 'module.exports')) continue;
      let value: unknown;
      try {
        value = outer[key];
      } catch {
        // Node snapshots a statically detected throwing getter as undefined;
        // an export getter never rejects module import.
        value = undefined;
      }
      defineSnapshot(namespace, key, value);
    }
  }

  Object.preventExtensions(namespace);
  if (record.state === 'loaded') record.cjsNamespace = namespace;
  return namespace;
}

function defineSnapshot(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    enumerable: true,
    get: () => value,
  });
}
