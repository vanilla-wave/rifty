/**
 * Owner table for the globals `@riftydev/runtime-js` installs inside a Worker
 * realm. Closes the "Ungoverned globals" Tier 2 #10 finding (2026-05-26
 * architecture review): pre-migration these were ad-hoc untyped keys on
 * `globalThis`/`self`, which M11 A-026's multi-realm Vite worker (ADR-0011
 * phase 3) could clobber, and which would collide with kernel's flat
 * `__riftyKernelSyncCall` / `__riftyKernelSyncRing__`.
 *
 * Collision boundary — every internal hook lives under one root key
 * {@link RUNTIME_JS_ROOT_KEY} (`'__rifty'`), which does not start with
 * `__riftyKernel`, so it never overlaps kernel's flat keys even when several
 * bundles share a realm (the M11 A-026 scenario). The helpers here are the
 * only sanctioned publish/read API; callers never index `globalThis.__rifty`.
 *
 * To add a key: register it in {@link RUNTIME_JS_GLOBAL_KEYS}, extend
 * {@link RuntimeJsGlobalRecord}, and document its publish/read sites here.
 *
 *  - `require`           — published by `worker-entry.ts`, read by the
 *                          public-mirror exposing it on `self.require`
 *                          for REPL code (Node convention).
 *  - `import`            — published by `worker-entry.ts`, read by the
 *                          public-mirror exposing it on `self.__riftyImport`.
 *  - `esmStash`          — published by `module-loader/esm.ts` per transformed
 *                          body; read by Playwright diagnostics needing the
 *                          original body on internal error.
 *  - `esmLastBody`       — published by `module-loader/esm.ts` on the
 *                          `new Function(...)` wrap-failure path so a
 *                          diagnostic snippet survives the throw; read by
 *                          the Playwright test rig after a wrap failure.
 *  - `esmLastFile`       — names the file whose body is in `esmLastBody`.
 *  - `createRequireImpl` — published by `__setCreateRequireImpl` in
 *                          `builtins/module.ts` (from `worker-entry.ts` and
 *                          the playground's `realVite.ts`); read by
 *                          `createRequire` there. Closure turning a
 *                          `from`-path into a bound `require()`.
 *  - `esbuild`           — exact upstream CJS outer, published before a guest
 *                          action imports esbuild and read by its CJS overlay.
 *  - `quickjsModulePromise` / `quickjsModuleSync` — one realm-wide QuickJS
 *                          preload authority. Production worker entries can
 *                          carry duplicate runtime-js module copies into the
 *                          same realm; both must observe the same VM engine.
 *
 * Multi-realm note (M11 A-026) — each realm imports its own runtime-js copy
 * and gets its own table on its own `globalThis.__rifty`; no realm reads
 * another's, and the publish helpers are realm-scoped by construction.
 */

import type { QuickJSWASMModule } from 'quickjs-emscripten-core';

/** Single root key under which every runtime-js global lives. */
export const RUNTIME_JS_ROOT_KEY = '__rifty' as const;

/** Documented runtime-js globals; values are sub-property names under `__rifty`. */
export const RUNTIME_JS_GLOBAL_KEYS = {
  require: 'require',
  import: 'import',
  esmStash: 'esmStash',
  esmLastBody: 'esmLastBody',
  esmLastFile: 'esmLastFile',
  createRequireImpl: 'createRequireImpl',
  esbuild: 'esbuild',
  quickjsModulePromise: 'quickjsModulePromise',
  quickjsModuleSync: 'quickjsModuleSync',
} as const;

/** Union of the documented key names. */
export type RuntimeJsGlobalKey = keyof typeof RUNTIME_JS_GLOBAL_KEYS;

/** Function type for `require(specifier)` published to the REPL. */
export type RuntimeRequire = (specifier: string) => unknown;

/** Function type for the async `import(specifier)` shim. */
export type RuntimeImport = (specifier: string) => Promise<unknown>;

/**
 * Function type the `createRequire(from)` builtin reads. Mirrors the
 * `RequireFn`-producing signature in `builtins/module.ts`; the `resolve` /
 * `cache` fields are added by the caller, not by this typedef.
 */
export type CreateRequireImpl = (from: string) => RuntimeRequire;

/** Opaque exact esbuild CJS outer; runtime-js owns identity, not its API. */
export type RuntimeEsbuildCjsOuter = object;

/**
 * Concrete value type per key — kept narrow so call sites stay `any`-free.
 * New keys must extend this alongside {@link RUNTIME_JS_GLOBAL_KEYS}.
 */
export interface RuntimeJsGlobalRecord {
  require: RuntimeRequire;
  import: RuntimeImport;
  esmStash: Record<string, string>;
  esmLastBody: string;
  esmLastFile: string;
  createRequireImpl: CreateRequireImpl;
  esbuild: RuntimeEsbuildCjsOuter;
  quickjsModulePromise: Promise<QuickJSWASMModule>;
  quickjsModuleSync: QuickJSWASMModule;
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
 * re-publishing a key overwrites it. On first publish the root is installed
 * as a non-enumerable, non-writable `globalThis` property; later publishes
 * mutate the existing root object.
 */
export function publishRuntimeGlobal<K extends RuntimeJsGlobalKey>(
  key: K,
  value: RuntimeJsGlobalRecord[K],
): void {
  const root = ensureRoot();
  // Assign through the typed surface so the caller's signature is checked here.
  (root as RuntimeJsGlobalRecord)[key] = value;
}

/**
 * Read a typed value from this realm's `__rifty` root. `null` when the key
 * was never published in this realm (e.g. main realm before the worker entry
 * ran, or after a paired {@link unpublishRuntimeGlobal}).
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
 * Remove a previously-published key. For the rare teardown path (a realm
 * tearing down before GC, or a test isolating per-case publishes). The root
 * object is left in place — other keys under it remain visible.
 */
export function unpublishRuntimeGlobal<K extends RuntimeJsGlobalKey>(key: K): void {
  const root = asGlobal()[RUNTIME_JS_ROOT_KEY];
  if (root === undefined) return;
  delete (root as Partial<RuntimeJsGlobalRecord>)[key];
}

/**
 * Documented keys in declaration order of {@link RUNTIME_JS_GLOBAL_KEYS}.
 * Used by tests iterating every key (publish/read roundtrip, collision asserts).
 */
export function runtimeGlobalKeys(): readonly RuntimeJsGlobalKey[] {
  return Object.keys(RUNTIME_JS_GLOBAL_KEYS) as RuntimeJsGlobalKey[];
}

/** Publish the exact esbuild CJS outer for this realm. */
export function publishRuntimeEsbuild(outer: RuntimeEsbuildCjsOuter): void {
  publishRuntimeGlobal('esbuild', outer);
}

/** Read the exact esbuild CJS outer for this realm, preserving identity. */
export function readRuntimeEsbuild(): RuntimeEsbuildCjsOuter | null {
  return readRuntimeGlobal('esbuild');
}
