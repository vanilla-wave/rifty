/**
 * CJS ↔ ESM interop helpers. We follow Node's pragmatic shape:
 *   - ESM importing CJS: a namespace where `default` is `module.exports` and
 *     own enumerable keys of `module.exports` are also exposed as named
 *     exports (Node calls this the cjs-module-lexer reflective form).
 *   - CJS requiring ESM: not allowed synchronously. The CJS loader throws and
 *     instructs callers to use `import()`.
 */
export function wrapCjsAsEsmNamespace(
  cjsExports: Record<string, unknown>,
): Record<string, unknown> {
  // If the CJS exports object already has a `default` key, expose it directly.
  // Otherwise the whole `module.exports` becomes `default`.
  const ns: Record<string, unknown> = Object.create(null);
  Object.defineProperty(ns, Symbol.toStringTag, { value: 'Module' });
  // Functions are objects too — `node:events` exports the EventEmitter class
  // as `module.exports` with named props attached. Early-returning on
  // `typeof !== 'object'` would drop those named bindings on the floor.
  if (cjsExports === null || (typeof cjsExports !== 'object' && typeof cjsExports !== 'function')) {
    ns.default = cjsExports;
    return ns;
  }
  if ('default' in cjsExports) {
    // Treat the explicit default as authoritative.
    ns.default = (cjsExports as Record<string, unknown>).default;
  } else {
    ns.default = cjsExports;
  }
  // Re-export every enumerable own key as a named binding pointing at the live
  // value on `cjsExports` (so mutations on the CJS side are reflected).
  for (const key of Object.keys(cjsExports)) {
    if (key === 'default') continue;
    Object.defineProperty(ns, key, {
      configurable: true,
      enumerable: true,
      get: () => (cjsExports as Record<string, unknown>)[key],
    });
  }
  return ns;
}
