/**
 * sql.js WASM engine bring-up for the rifty `node:sqlite` shim (ADR-0065).
 *
 * The load-bearing problem this module solves: opencode's boot path constructs
 * a synchronous `node:sqlite` `DatabaseSync` at Effect layer-build time (Spike
 * C), but a WASM SQLite module can only be initialised ASYNCHRONOUSLY. This
 * module is the bridge — it eagerly brings the WASM module up via an async
 * `initSqliteEngine()`, memoises the resulting (fully synchronous) `SqlJsStatic`
 * handle, and exposes a synchronous `getSqliteEngine()` that the synchronous
 * `DatabaseSync` constructor can call AFTER init has resolved.
 *
 * Engine choice (sql.js, in-memory, synchronous after one async bring-up) and
 * the deferral of OPFS persistence are ratified in ADR-0065.
 *
 * This module owns NO `DatabaseSync` surface itself — it only owns the engine
 * handle. The `DatabaseSync`-shaped facade and its `node:sqlite` builtin
 * registration land in a separate module/task on top of this bridge.
 */
import initSqlJs from 'sql.js';
import type { SqlJsConfig, SqlJsStatic } from 'sql.js';

/**
 * Memoised promise for the one-time WASM bring-up. `undefined` until the first
 * `initSqliteEngine()` call. Promise-level memoisation (rather than memoising
 * the resolved value) guarantees concurrent callers share a SINGLE bring-up
 * even if they call before the first one settles.
 */
let enginePromise: Promise<SqlJsStatic> | undefined;

/**
 * The resolved engine handle, set once `enginePromise` settles. Kept separately
 * so the SYNCHRONOUS `getSqliteEngine()` can return it without touching the
 * promise. `undefined` until init resolves.
 */
let engine: SqlJsStatic | undefined;

/**
 * Whether we are running under a Node-style runtime (vs a browser/Worker
 * realm). Drives how the sql.js WASM file is located: Node resolves a
 * filesystem path via the module loader; the browser leaves it to the
 * bundler/`import.meta.resolve`.
 */
function isNodeRuntime(): boolean {
  return (
    typeof process !== 'undefined' && process.versions != null && process.versions.node != null
  );
}

/**
 * Default `locateFile` for the sql.js Emscripten glue. sql.js needs to know
 * where `sql-wasm.wasm` lives.
 *
 * In Node we resolve a filesystem path via `createRequire(...).resolve` (the
 * glue reads the WASM from disk); this works regardless of pnpm's store-symlink
 * layout and is available in plain ESM and vitest SSR alike. In a
 * browser/bundler realm we hand back the `import.meta.resolve` URL for the glue
 * to `fetch`.
 */
function defaultLocateFile(file: string): string {
  const spec = `sql.js/dist/${file}`;
  if (isNodeRuntime()) {
    const { createRequire } = nodeModule();
    return createRequire(import.meta.url).resolve(spec);
  }
  return import.meta.resolve(spec);
}

/**
 * Node-only `node:module` access, isolated so bundlers can ignore it in browser
 * builds. Never reached in a browser realm because `defaultLocateFile` guards
 * on {@link isNodeRuntime}. Uses `process.getBuiltinModule` (Node ≥22.3), which
 * is synchronous and present in both CJS and ESM.
 */
function nodeModule(): {
  createRequire: (path: string) => { resolve: (spec: string) => string };
} {
  const getBuiltin = (
    process as unknown as {
      getBuiltinModule?: (id: string) => {
        createRequire: (path: string) => { resolve: (spec: string) => string };
      };
    }
  ).getBuiltinModule;
  if (typeof getBuiltin === 'function') {
    return getBuiltin('node:module');
  }
  throw new Error('sqlite engine: cannot resolve node:module to locate the sql.js WASM file');
}

/**
 * Eagerly bring up the sql.js WASM engine. Resolves to the synchronous
 * `SqlJsStatic` handle (whose `.Database` constructs in-memory databases
 * synchronously). Idempotent and memoised: the WASM module is brought up at
 * most once per process; every call returns the SAME `SqlJsStatic`.
 *
 * @param config - Optional sql.js config. Used only on the FIRST call; ignored
 *   on subsequent (memoised) calls. Mainly an injection point for `locateFile`
 *   in tests/embedders. When omitted, {@link defaultLocateFile} is used.
 * @returns A promise for the shared, synchronous engine handle.
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
 * @throws {Error} If the engine has not been initialized yet. This is a loud,
 *   clear failure by design (ADR-0065 §D4, no silent stubs) — never returns
 *   `null`/`undefined`.
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
 * safe to call synchronously. `false` before init resolves, `true` after.
 */
export function isSqliteEngineReady(): boolean {
  return engine !== undefined;
}
