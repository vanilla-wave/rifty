/**
 * sql.js WASM engine bring-up for the rifty `node:sqlite` shim (ADR-0065).
 *
 * Problem this module solves: opencode's boot path constructs a synchronous
 * `node:sqlite` `DatabaseSync` at Effect layer-build time (Spike C), but a WASM
 * SQLite module can only be initialised ASYNCHRONOUSLY. This module is the
 * bridge — async `initSqliteEngine()` brings the WASM module up and memoises the
 * (fully synchronous) `SqlJsStatic` handle, which the synchronous
 * `getSqliteEngine()` returns AFTER init resolves.
 *
 * Engine choice (sql.js, in-memory, sync after one async bring-up) and deferral
 * of OPFS persistence are ratified in ADR-0065.
 *
 * Owns only the engine handle, NOT any `DatabaseSync` surface — the facade and
 * `node:sqlite` builtin registration land in a separate module on top of this.
 */
import initSqlJs from 'sql.js';
import type { SqlJsConfig, SqlJsStatic } from 'sql.js';

/**
 * Memoised promise for the one-time WASM bring-up. Promise-level memoisation
 * (not the resolved value) guarantees concurrent callers share a SINGLE
 * bring-up even if they call before the first settles.
 */
let enginePromise: Promise<SqlJsStatic> | undefined;

/**
 * Resolved engine handle. Kept separate from the promise so the SYNCHRONOUS
 * `getSqliteEngine()` can return it without touching the promise.
 */
let engine: SqlJsStatic | undefined;

type GetBuiltinModule = (id: string) => {
  createRequire: (path: string) => { resolve: (spec: string) => string };
};

/**
 * Real-Node `process.getBuiltinModule` (Node ≥22.3), captured at MODULE-EVAL
 * time. The capture (not a lazy `process` read) is load-bearing: embedders swap
 * `globalThis.process` for the rifty shim (worker bootstrap, harnesses calling
 * `installProcessGlobals()`) BEFORE the engine's first init, and the shim
 * advertises `versions.node` without `getBuiltinModule` — a lazy Node-detection
 * here used to throw deep inside sql.js and hang the memoised init forever.
 * `undefined` ⇔ not a real Node realm ⇒ browser path below.
 */
const nodeGetBuiltinModule: GetBuiltinModule | undefined = (() => {
  if (typeof process === 'undefined') return undefined;
  const getBuiltin = (process as unknown as { getBuiltinModule?: GetBuiltinModule })
    .getBuiltinModule;
  return typeof getBuiltin === 'function' ? getBuiltin.bind(process) : undefined;
})();

/**
 * Default `locateFile` telling the sql.js glue where `sql-wasm.wasm` lives.
 *
 * Node: filesystem path via `createRequire(...).resolve` — works regardless of
 * pnpm's store-symlink layout, in plain ESM and vitest SSR alike. Browser:
 * `import.meta.resolve` URL for the glue to `fetch` (bundled worker realms
 * should pass `wasmBinary`/`locateFile` explicitly instead).
 */
function defaultLocateFile(file: string): string {
  const spec = `sql.js/dist/${file}`;
  if (nodeGetBuiltinModule) {
    const { createRequire } = nodeGetBuiltinModule('node:module');
    return createRequire(import.meta.url).resolve(spec);
  }
  return import.meta.resolve(spec);
}

/**
 * Eagerly bring up the sql.js WASM engine. Idempotent and memoised: the WASM
 * module is brought up at most once per process; every call returns the SAME
 * `SqlJsStatic` (whose `.Database` constructs in-memory databases synchronously).
 *
 * @param config - sql.js config; used only on the FIRST call, ignored on
 *   memoised ones. Injection point for `locateFile` in tests/embedders;
 *   defaults to {@link defaultLocateFile}.
 * @returns Promise for the shared, synchronous engine handle.
 */
export function initSqliteEngine(config?: SqlJsConfig): Promise<SqlJsStatic> {
  if (enginePromise === undefined) {
    const cfg: SqlJsConfig = { locateFile: defaultLocateFile, ...config };
    enginePromise = initSqlJs(cfg).then((sql) => {
      engine = sql;
      return sql;
    });
  }
  return enginePromise;
}

/**
 * Synchronously return the brought-up engine handle. This is the synchronous
 * half of the bridge that the synchronous `DatabaseSync` constructor depends
 * on: it MUST be called only after {@link initSqliteEngine} has resolved.
 *
 * @throws {Error} If not yet initialized — loud failure by design (ADR-0065
 *   §D4, no silent stubs); never returns `null`/`undefined`.
 * @returns The shared, synchronous {@link SqlJsStatic} engine handle.
 */
export function getSqliteEngine(): SqlJsStatic {
  if (engine === undefined) {
    throw new Error(
      'sqlite engine not initialized: call (and await) initSqliteEngine() ' +
        'before getSqliteEngine()',
    );
  }
  return engine;
}

/**
 * Whether {@link initSqliteEngine} has resolved and {@link getSqliteEngine} is
 * safe to call synchronously.
 */
export function isSqliteEngineReady(): boolean {
  return engine !== undefined;
}
