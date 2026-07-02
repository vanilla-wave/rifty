/**
 * Loader for the TypeScript standard-library declaration files (`lib.*.d.ts`).
 *
 * The language-service host needs the std lib `.d.ts` as a `Map<filename,
 * contents>` to serve `/lib.*.d.ts` reads and answer `getDefaultLibFileName`.
 * The lib set MUST match the pinned compiler (ADR-0166) — so we never bundle a
 * separate copy: in Node we read straight from the installed compiler's `lib/`;
 * in the browser we fetch a build-time-vendored JSON bundle of those same files
 * (`scripts/vendor-ts-lib.mjs` → `vendor/lib-bundle.json`).
 *
 * Two concerns, mirroring `runtime-js`'s `quickjs-loader.ts`:
 *   1. {@link getTsLibUrl} — env-config of the bundle location (D-004): URL from
 *      bootstrap global / build env / Node env, never hardcoded elsewhere.
 *   2. {@link loadLibDts} — one-time async load; concurrent/repeat calls share a
 *      single in-flight promise and resolve to the SAME Map singleton.
 */

import type { FsSync } from '@riftydev/vfs';
import type tsVendored from 'typescript';
import { readFileUtf8 } from './vfs-ts-host.ts';

type TypeScriptApi = typeof tsVendored;

export interface LoadedTypeScriptCompiler {
  readonly ts: TypeScriptApi;
  readonly libMap: ReadonlyMap<string, string>;
  readonly source: 'workspace';
  readonly packageRoot?: string;
}

/** Bootstrap-global key carrying the vendored lib bundle URL (playground/host). */
export const TS_LIB_URL_ENV = '__RIFTY_TS_LIB_URL' as const;

/**
 * Vendored lib-bundle URL, in priority order:
 *   1. `globalThis.__RIFTY_TS_LIB_URL` (host/playground bootstrap),
 *   2. `globalThis.import.meta.env.RIFTY_TS_LIB_URL` (Vite-style build env),
 *   3. `process.env.RIFTY_TS_LIB_URL` (Node-side test harness),
 *   4. `/ts-lib/lib-bundle.json` (default — host serves the vendored asset here).
 *
 * Never hardcode this URL elsewhere (D-004). Mirrors
 * {@link @riftydev/runtime-js!getQuickjsWasmUrl}. Used only by the browser
 * branch of {@link loadLibDts}; Node reads from the compiler install directly.
 */
export function getTsLibUrl(): string {
  const g = globalThis as Record<string, unknown>;
  const fromBootstrap = g[TS_LIB_URL_ENV];
  if (typeof fromBootstrap === 'string' && fromBootstrap.length > 0) return fromBootstrap;

  // Vite-style: globalThis.import?.meta?.env?.RIFTY_TS_LIB_URL
  const importObj = g.import;
  if (importObj && typeof importObj === 'object') {
    const meta = (importObj as { meta?: unknown }).meta;
    if (meta && typeof meta === 'object') {
      const env = (meta as { env?: unknown }).env;
      if (env && typeof env === 'object') {
        const value = (env as Record<string, unknown>).RIFTY_TS_LIB_URL;
        if (typeof value === 'string' && value.length > 0) return value;
      }
    }
  }

  // Node-side (vitest, harness).
  if (typeof process !== 'undefined' && process.env) {
    const fromEnv = process.env.RIFTY_TS_LIB_URL;
    if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
  }

  return '/ts-lib/lib-bundle.json';
}

let libsPromise: Promise<ReadonlyMap<string, string>> | undefined;

/**
 * True when running under a REAL Node.js (vitest/parity), not the browser.
 *
 * `process.versions.node` alone is NOT enough: rifty's in-worker `process` shim
 * impersonates Node (`versions.node` is set — see runtime-js process-identity /
 * the `process-versions-node-honesty` backlog), so a kernel-spawned LS worker
 * would wrongly take the Node lib-load path (`import('node:fs')` → Vite's empty
 * browser stub → crash). Gate on the ABSENCE of a browser/worker realm too: real
 * Node has no `window`, no `WorkerGlobalScope`, and no `importScripts`. The LS
 * runs in a DedicatedWorker in the browser, which has `importScripts` — so this
 * correctly routes it to the vendored-bundle fetch (ADR-0166 P1.9).
 */
function isNode(): boolean {
  const g = globalThis as {
    window?: unknown;
    WorkerGlobalScope?: unknown;
    importScripts?: unknown;
  };
  const isBrowserRealm =
    typeof g.window !== 'undefined' ||
    typeof g.WorkerGlobalScope !== 'undefined' ||
    typeof g.importScripts === 'function';
  return (
    !isBrowserRealm &&
    typeof process !== 'undefined' &&
    typeof process.versions === 'object' &&
    typeof process.versions.node === 'string'
  );
}

/**
 * Read the std lib `.d.ts` straight from the installed `typescript` package's
 * `lib/` dir (guarantees the lib set matches the pinned compiler). Node-only;
 * `node:*` builtins are imported dynamically so the browser bundle stays clean.
 */
async function loadFromNode(): Promise<ReadonlyMap<string, string>> {
  const [{ createRequire }, fs, path] = await Promise.all([
    import('node:module'),
    import('node:fs'),
    import('node:path'),
  ]);
  // Resolve relative to THIS module so we pick up the typescript this package
  // depends on, regardless of the consumer's cwd.
  const require = createRequire(import.meta.url);
  const tsPkgJson = require.resolve('typescript/package.json');
  const libDir = path.join(path.dirname(tsPkgJson), 'lib');

  const libRe = /^lib(\.[^.]+)*\.d\.ts$/;
  const map = new Map<string, string>();
  for (const name of fs.readdirSync(libDir)) {
    if (!libRe.test(name)) continue;
    map.set(name, fs.readFileSync(path.join(libDir, name), 'utf8'));
  }
  if (map.size === 0) {
    throw new Error(`no lib*.d.ts found in ${libDir} — is the pinned typescript installed?`);
  }
  return map;
}

/**
 * Fetch the build-time-vendored lib bundle (a `{ filename: contents }` JSON map)
 * from {@link getTsLibUrl}. Browser path; one fetch, then memoized by the caller.
 */
async function loadFromBrowser(): Promise<ReadonlyMap<string, string>> {
  const url = getTsLibUrl();
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`failed to fetch ts lib bundle from ${url}: HTTP ${res.status}`);
  }
  const json = (await res.json()) as Record<string, string>;
  const map = new Map<string, string>();
  for (const [name, contents] of Object.entries(json)) {
    if (typeof contents !== 'string') {
      throw new Error(`ts lib bundle entry "${name}" is not a string`);
    }
    map.set(name, contents);
  }
  if (map.size === 0) {
    throw new Error(`ts lib bundle at ${url} is empty`);
  }
  return map;
}

/**
 * The TypeScript std lib as a `Map<filename, contents>` (e.g. `lib.es5.d.ts` →
 * file text). Idempotent: concurrent and repeat calls share one in-flight
 * promise and resolve to the SAME Map singleton.
 *
 * Node (vitest/parity): reads from the installed compiler's `lib/` directly.
 * Browser: fetches the vendored bundle via {@link getTsLibUrl} (memoized).
 */
export function loadLibDts(): Promise<ReadonlyMap<string, string>> {
  if (!libsPromise) {
    libsPromise = (isNode() ? loadFromNode() : loadFromBrowser()).catch((err) => {
      // Don't cache a rejection — let a later call retry.
      libsPromise = undefined;
      throw err;
    });
  }
  return libsPromise;
}

function parentDir(path: string): string {
  if (path === '/') return '/';
  const i = path.lastIndexOf('/');
  return i <= 0 ? '/' : path.slice(0, i);
}

/** Workspace `typescript` package dir (walk-up existence probe, error-message use only). */
function findWorkspaceTypeScriptDir(fsSync: FsSync, projectRoot: string): string | undefined {
  let dir = projectRoot;
  for (;;) {
    const candidate = `${dir === '/' ? '' : dir}/node_modules/typescript`;
    if (fsSync.statSyncOrNull(candidate)?.isDirectory) return candidate;
    if (dir === '/') return undefined;
    dir = parentDir(dir);
  }
}

export interface WorkspaceTypeScriptEntry {
  readonly entryPath: string;
  readonly source: string;
  readonly packageRoot: string;
}

/**
 * Resolve the workspace `typescript` compiler entry through rifty's module
 * resolver (Node-shaped package.json `exports`/`main` + node_modules walk-up;
 * its Node deltas are pinned in the resolver's own parity suite) — never a
 * hardcoded `lib/typescript.js` probe. Dynamic import keeps the module-loader
 * out of bundles that never load a workspace compiler.
 */
export async function resolveWorkspaceTypeScriptEntry(
  fsSync: FsSync,
  projectRoot: string,
): Promise<WorkspaceTypeScriptEntry> {
  const { createModuleLoader } = await import('@riftydev/runtime-js/loader');
  const { resolver } = createModuleLoader(fsSync);
  try {
    const resolved = resolver.resolve('typescript', { fromFile: projectRoot, esm: false });
    return {
      entryPath: resolved.id,
      source: resolved.source,
      packageRoot: resolved.packageRoot ?? parentDir(resolved.id),
    };
  } catch (err) {
    const packageDir = findWorkspaceTypeScriptDir(fsSync, projectRoot);
    if (packageDir === undefined) {
      throw new Error('TypeScript is not installed in this project; run npm install -D typescript');
    }
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `workspace TypeScript at ${packageDir} has no resolvable compiler entry (package.json exports/main): ${detail}`,
    );
  }
}

/**
 * Std lib `.d.ts` next to the resolved compiler entry — tsc's own rule
 * (`getDefaultLibFilePath` = dirname of the executing file), so relocated
 * builds keep their matching lib set.
 */
function loadWorkspaceLibDts(fsSync: FsSync, entryPath: string): ReadonlyMap<string, string> {
  const libDir = parentDir(entryPath);
  const libRe = /^lib(\.[^.]+)*\.d\.ts$/;
  const map = new Map<string, string>();
  for (const entry of fsSync.readdirSync(libDir)) {
    if (!entry.isFile || !libRe.test(entry.name)) continue;
    const path = `${libDir}/${entry.name}`;
    const text = readFileUtf8(fsSync, path);
    if (text === undefined) throw new Error(`workspace TypeScript lib unreadable: ${path}`);
    map.set(entry.name, text);
  }
  if (map.size === 0) {
    throw new Error(
      `workspace TypeScript has no lib*.d.ts files next to its compiler entry (${libDir})`,
    );
  }
  return map;
}

function evaluateWorkspaceTypeScript(source: string, fileName: string): TypeScriptApi {
  // `require`/`process` are passed as undefined DELIBERATELY: the ts bundle
  // probes both behind `typeof` guards to choose its host (ts.sys detection) —
  // undefined gives it the browser shape it fully supports. A loud-throwing
  // require would flip `typeof require` to 'function' and steer ts down the
  // Node sys path into the thrower.
  const module = { exports: {} as unknown };
  const exports = module.exports;
  const run = new Function(
    'module',
    'exports',
    'require',
    'process',
    '__filename',
    '__dirname',
    `${source}\nreturn module.exports;`,
  ) as (
    module: { exports: unknown },
    exports: unknown,
    require: undefined,
    process: undefined,
    fileName: string,
    dirName: string,
  ) => unknown;
  const loaded = run(module, exports, undefined, undefined, fileName, parentDir(fileName));
  const candidate = loaded && typeof loaded === 'object' ? loaded : module.exports;
  const api = candidate as Partial<TypeScriptApi>;
  if (
    typeof api.version !== 'string' ||
    typeof api.createLanguageService !== 'function' ||
    typeof api.parseJsonConfigFileContent !== 'function' ||
    typeof api.getDefaultLibFileName !== 'function'
  ) {
    throw new Error(`workspace TypeScript at ${fileName} did not export a compiler API`);
  }
  return candidate as TypeScriptApi;
}

export async function loadTypeScriptCompilerForProject(
  fsSync: FsSync,
  projectRoot: string,
): Promise<LoadedTypeScriptCompiler> {
  const entry = await resolveWorkspaceTypeScriptEntry(fsSync, projectRoot);
  const ts = evaluateWorkspaceTypeScript(entry.source, entry.entryPath);
  return {
    ts,
    libMap: loadWorkspaceLibDts(fsSync, entry.entryPath),
    source: 'workspace',
    packageRoot: entry.packageRoot,
  };
}
