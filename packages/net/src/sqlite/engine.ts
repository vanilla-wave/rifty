/**
 * sql.js WASM engine bring-up for the rifty `node:sqlite` shim (ADR-0065).
 *
 * Problem this module solves: `node:sqlite`'s `DatabaseSync` is a synchronous
 * API, but the default WASM bring-up (fetch + streaming instantiate) is async.
 * Two bridges, one shared memo:
 *   - async `initSqliteEngine()` — default path; awaited ahead of first use.
 *   - sync `initSqliteEngineSync(bytes)` — caller supplies the wasm bytes; an
 *     emscripten `instantiateWasm` hook compiles them with the SYNCHRONOUS
 *     `new WebAssembly.Instance(new WebAssembly.Module(bytes))`, and the whole
 *     sql.js run (through api.js attaching `Database`) completes inside the
 *     call. Legal in worker realms; the main thread restricts large sync
 *     compiles — hosts call this from workers.
 *
 * Byte SOURCING stays with the caller (no asset URL here, D-004); the
 * {@link setSqliteEngineSyncProvider} seam lets a host realm hand bytes lazily
 * so the builtin factory can self-initialize on first `require('node:sqlite')`.
 *
 * Engine choice (sql.js, in-memory) and deferral of OPFS persistence are
 * ratified in ADR-0065. Owns only the engine handle, NOT any `DatabaseSync`
 * surface — facade and builtin registration live on top.
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
 * Synchronously bring up the sql.js WASM engine from caller-supplied wasm
 * bytes. Spike-proven mechanics: sql.js's `initSqlJs(config)` uses the config
 * object AS the emscripten Module; with an `instantiateWasm` hook the whole
 * bring-up (instantiate → run → api.js attaching `Database`) completes inside
 * the `initSqlJs` call, so `config.Database` is usable before this returns —
 * the glue's promise is a formality resolved via postRun.
 *
 * Memo interplay (shared with {@link initSqliteEngine}):
 *   - engine READY (either path) → returns it; `wasmBytes`/`config` ignored.
 *   - async init PENDING → throws. The sql.js glue memoises ONE module per
 *     realm and silently ignores later configs — a second bring-up is
 *     impossible, and returning a not-ready engine would be a silent stub.
 *   - fresh → sync bring-up; later {@link initSqliteEngine} calls reuse it.
 *
 * Realm note: sync `new WebAssembly.Module` on large buffers is legal in
 * workers, restricted on the browser main thread — browser hosts call this
 * from worker realms only.
 *
 * @param wasmBytes - `sql-wasm.wasm` contents; sourcing is the CALLER's job
 *   (sync XHR, prefetch, fs) — no asset URL is hardcoded here (D-004).
 * @param config - Optional extra sql.js config; the `instantiateWasm` hook is
 *   applied after it and cannot be overridden.
 * @throws {Error} If an async init is pending, or if the sql.js glue was
 *   already primed by another module instance in this realm (its memo ignores
 *   the sync config, so the bring-up cannot complete synchronously).
 * @returns The ready {@link SqlJsStatic} engine handle.
 */
export function initSqliteEngineSync(
  wasmBytes: ArrayBuffer | Uint8Array,
  config?: SqlJsConfig,
): SqlJsStatic {
  if (engine !== undefined) return engine;
  if (enginePromise !== undefined) {
    throw new Error(
      'sqlite engine bring-up already pending: initSqliteEngine() was called and has not ' +
        'resolved yet — await it instead of calling initSqliteEngineSync()',
    );
  }
  const moduleConfig: SqlJsConfig & Partial<SqlJsStatic> = {
    ...config,
    // Own hook LAST so caller config cannot clobber the sync path.
    instantiateWasm(imports, receiveInstance) {
      // Node's Buffer is typed Uint8Array<ArrayBufferLike>, which TS excludes
      // from BufferSource; widening cast avoids forcing callers to copy —
      // wasm compile copies the bytes internally anyway.
      const module = new WebAssembly.Module(wasmBytes as BufferSource);
      const instance = new WebAssembly.Instance(module, imports);
      receiveInstance(instance);
      return instance.exports;
    },
  };
  // Returned promise ignored on purpose: on this path it is already resolved
  // (postRun ran synchronously); readiness is checked via the Module itself.
  void initSqlJs(moduleConfig);
  if (typeof moduleConfig.Database !== 'function') {
    throw new Error(
      'sqlite sync bring-up did not complete synchronously: the sql.js glue memoises the ' +
        'first bring-up per realm and ignored the sync config (another copy of this module ' +
        'already initialized it) — await initSqliteEngine() instead',
    );
  }
  engine = moduleConfig as SqlJsStatic;
  enginePromise = Promise.resolve(engine);
  return engine;
}

/**
 * Provider of `sql-wasm.wasm` bytes for on-demand sync bring-up. Called at
 * most once, on the first `require('node:sqlite')` with the engine not ready.
 */
export type SqliteWasmBytesProvider = () => ArrayBuffer | Uint8Array;

let syncBytesProvider: SqliteWasmBytesProvider | undefined;

/**
 * Install the wasm-bytes provider the `node:sqlite` builtin factory uses to
 * self-initialize on first require. Installing is cheap — no wasm cost until
 * the first require finds the engine not ready. Host realms set this at boot
 * so `node:sqlite` works with no preset flag and no ahead-of-time await
 *. Last install wins; the provider is
 * consulted only while the engine is not yet up.
 */
export function setSqliteEngineSyncProvider(provider: SqliteWasmBytesProvider): void {
  syncBytesProvider = provider;
}

/**
 * Builtin-factory hook: if the engine is not ready and a provider is
 * installed, run the sync bring-up now. No provider → no-op; the loud
 * {@link getSqliteEngine} error fires at first `DatabaseSync` construction.
 * Provider/bring-up failures propagate — the registry does not cache a thrown
 * factory, so a fixed provider can retry on the next require.
 */
export function ensureSqliteEngineFromProvider(): void {
  if (engine !== undefined || syncBytesProvider === undefined) return;
  initSqliteEngineSync(syncBytesProvider());
}

/**
 * Synchronously return the brought-up engine handle. This is the synchronous
 * half of the bridge that the synchronous `DatabaseSync` constructor depends
 * on: it MUST be called only after {@link initSqliteEngine} has resolved (or a
 * sync bring-up completed).
 *
 * @throws {Error} If not yet initialized — loud failure by design (ADR-0065
 *   §D4, no silent stubs); never returns `null`/`undefined`.
 * @returns The shared, synchronous {@link SqlJsStatic} engine handle.
 */
export function getSqliteEngine(): SqlJsStatic {
  if (engine === undefined) {
    throw new Error(
      'sqlite engine not initialized: await initSqliteEngine() or call ' +
        'initSqliteEngineSync(bytes) before use, or install ' +
        'setSqliteEngineSyncProvider(() => wasmBytes) at boot so ' +
        "require('node:sqlite') brings the engine up on demand",
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
