/**
 * Owner table for the globals `@rifty/runtime-js` installs inside a Worker
 * realm.
 *
 * Background — closes the "Ungoverned globals" Tier 2 #10 finding from the
 * 2026-05-26 architecture review. Pre-migration, runtime-js wrote ad-hoc
 * keys directly to `globalThis` / `self` (`__riftyEsmStash`,
 * `__riftyLastEsmBody`, `__riftyLastEsmFile`) and exposed a closure-bound
 * `__setCreateRequireImpl` plumbing function from `builtins/module.ts`.
 * None of those were documented as a contract; reading them was untyped.
 * When M11 A-026 spawns Vite in its own Worker realm (ADR-0011 phase 3
 * multi-realm), additional bundles in the realm could clobber these names
 * — and the unguarded flat keys would start colliding with kernel's
 * `shared-globals.ts` published `__riftyKernelSyncCall` /
 * `__riftyKernelSyncRing__`.
 *
 * Design choice (collision boundary) — unlike kernel which keeps two flat
 * keys (`__riftyKernelSyncCall`, `__riftyKernelSyncRing__`) at the top of
 * `globalThis`, runtime-js groups every internal hook under a single root
 * key {@link RUNTIME_JS_ROOT_KEY} (`'__rifty'`). The kernel keys keep their
 * `__riftyKernel*` flat shape (their owner table is intentionally narrow
 * and pre-dates this one). The two namespaces meet at a single collision
 * point: the flat key `__rifty` does not start with `__riftyKernel`, so the
 * two surfaces never overlap even when several bundles share one realm
 * (the scenario M11 A-026 will land us in). Inside `__rifty.*` each key is
 * its own sub-property; the helpers in this file are the only sanctioned
 * publish / read API. Callers never index `globalThis.__rifty` directly.
 *
 * Documented keys — every key here is owned by `@rifty/runtime-js`. The
 * comment next to each one names the call site that publishes the value
 * and the call site that reads it. If you add a key, register it in
 * {@link RUNTIME_JS_GLOBAL_KEYS}, extend
 * {@link RuntimeJsGlobalRecord}, and document its lifecycle here.
 *
 *  - `require`           — published by `worker-entry.ts`, read by the
 *                          public-mirror that exposes it on `self.require`
 *                          for user REPL code (Node convention).
 *  - `import`            — published by `worker-entry.ts`, read by the
 *                          public-mirror that exposes it on
 *                          `self.__riftyImport` for REPL `import()` calls.
 *  - `esmStash`          — published by `module-loader/esm.ts` each time
 *                          the ESM transformer emits a transformed body;
 *                          read by Playwright diagnostics when an
 *                          internal error needs the original body.
 *  - `esmLastBody`       — published by `module-loader/esm.ts` on the
 *                          `new Function(...)` wrap-failure path so a
 *                          diagnostic snippet survives the throw; read by
 *                          Playwright when the test rig pulls the body
 *                          out of the page after a wrap failure.
 *  - `esmLastFile`       — sibling to `esmLastBody`, names the file whose
 *                          body is sitting in `esmLastBody`.
 *  - `createRequireImpl` — published by `__setCreateRequireImpl` in
 *                          `builtins/module.ts` (called from
 *                          `worker-entry.ts` and from the playground's
 *                          `realVite.ts` adapter); read by `createRequire`
 *                          in the same file. Holds the closure that turns
 *                          a `from`-path into a `require()` function bound
 *                          to it.
 *
 * Multi-realm note (M11 A-026) — when Vite migrates to its own Worker
 * realm, that realm imports its own copy of `@rifty/runtime-js`, and so
 * gets its own copy of the owner table on its own `globalThis.__rifty`.
 * No realm reads another realm's table; the publish helpers are realm-
 * scoped by construction. The kernel-owned `__riftyKernelSyncCall` /
 * `__riftyKernelSyncRing__` keys land on the same realm under their own
 * names and do not collide with `__rifty`.
 */

/** Single root key under which every runtime-js global lives. */
export const RUNTIME_JS_ROOT_KEY = '__rifty' as const;

/**
 * Type-level enumeration of every documented runtime-js global. The string
 * values are the sub-property names inside the `__rifty` root.
 */
export const RUNTIME_JS_GLOBAL_KEYS = {
  require: 'require',
  import: 'import',
  esmStash: 'esmStash',
  esmLastBody: 'esmLastBody',
  esmLastFile: 'esmLastFile',
  createRequireImpl: 'createRequireImpl',
} as const;

/** Union of the documented key names. */
export type RuntimeJsGlobalKey = keyof typeof RUNTIME_JS_GLOBAL_KEYS;

/** Function type for `require(specifier)` published to the REPL. */
export type RuntimeRequire = (specifier: string) => unknown;

/** Function type for the async `import(specifier)` shim. */
export type RuntimeImport = (specifier: string) => Promise<unknown>;

/**
 * Function type the `createRequire(from)` builtin reads. Mirrors the local
 * `RequireFn`-producing signature in `builtins/module.ts`; the additional
 * `resolve` / `cache` fields are added by the caller, not by this typedef.
 */
export type CreateRequireImpl = (from: string) => RuntimeRequire;

/**
 * Concrete value type per key. Constrained narrowly so consumers stay
 * `any`-free at call sites; new keys must extend this record alongside
 * {@link RUNTIME_JS_GLOBAL_KEYS}.
 */
export interface RuntimeJsGlobalRecord {
  require: RuntimeRequire;
  import: RuntimeImport;
  esmStash: Record<string, string>;
  esmLastBody: string;
  esmLastFile: string;
  createRequireImpl: CreateRequireImpl;
}

interface GlobalWithRuntimeRoot {
  [RUNTIME_JS_ROOT_KEY]?: Partial<RuntimeJsGlobalRecord>;
}

function asGlobal(): GlobalWithRuntimeRoot {
  return globalThis as unknown as GlobalWithRuntimeRoot;
}

function ensureRoot(): Partial<RuntimeJsGlobalRecord> {
  const g = asGlobal();
  let root = g[RUNTIME_JS_ROOT_KEY];
  if (root === undefined) {
    root = Object.create(null) as Partial<RuntimeJsGlobalRecord>;
    Object.defineProperty(globalThis, RUNTIME_JS_ROOT_KEY, {
      value: root,
      writable: false,
      configurable: true,
      enumerable: false,
    });
  }
  return root;
}

/**
 * Install a typed value on this realm's `__rifty` root. Idempotent —
 * re-publishing the same key overwrites the previous value. The root
 * itself is installed as a non-enumerable, non-writable property of
 * `globalThis` on first publish; subsequent publishes mutate the existing
 * root object.
 */
export function publishRuntimeGlobal<K extends RuntimeJsGlobalKey>(
  key: K,
  value: RuntimeJsGlobalRecord[K],
): void {
  const root = ensureRoot();
  // Assigning through the typed surface so the caller's signature is
  // checked at the publish site.
  (root as RuntimeJsGlobalRecord)[key] = value;
}

/**
 * Read a typed value from this realm's `__rifty` root. Returns `null` when
 * the key has never been published in the current realm (e.g. on the main
 * realm before the runtime-js worker entry has run, or after a paired
 * {@link unpublishRuntimeGlobal}).
 */
export function readRuntimeGlobal<K extends RuntimeJsGlobalKey>(
  key: K,
): RuntimeJsGlobalRecord[K] | null {
  const root = asGlobal()[RUNTIME_JS_ROOT_KEY];
  if (root === undefined) return null;
  const value = (root as Partial<RuntimeJsGlobalRecord>)[key];
  return value === undefined ? null : (value as RuntimeJsGlobalRecord[K]);
}

/**
 * Remove a previously-published key. Designed for the (rare) teardown
 * path: a realm tearing down before its globals get GC'd, or a test
 * isolating per-case publishes. The root object itself is left in place —
 * other keys under it remain visible.
 */
export function unpublishRuntimeGlobal<K extends RuntimeJsGlobalKey>(key: K): void {
  const root = asGlobal()[RUNTIME_JS_ROOT_KEY];
  if (root === undefined) return;
  delete (root as Partial<RuntimeJsGlobalRecord>)[key];
}

/**
 * Return the enumeration of documented keys. Stable order matches the
 * declaration order in {@link RUNTIME_JS_GLOBAL_KEYS}. Useful in tests
 * that iterate every key (publish/read roundtrip, key-collision asserts).
 */
export function runtimeGlobalKeys(): readonly RuntimeJsGlobalKey[] {
  return Object.keys(RUNTIME_JS_GLOBAL_KEYS) as RuntimeJsGlobalKey[];
}
