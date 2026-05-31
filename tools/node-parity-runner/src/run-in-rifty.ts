/**
 * Run case code through the rifty module loader and capture stdout.
 *
 * Scope: the loader is the rifty path under test. We deliberately do NOT
 * monkey-patch global `process` or `Promise.prototype.then` here — that would
 * leak into the runner itself. Behaviours that depend on rifty's promise/
 * nextTick patches are covered by the conformance suite, which can install
 * the patches in a controlled `beforeAll`/`afterAll` scope. The parity runner
 * focuses on module-shape semantics: `node:path`, `node:buffer`, `node:util`,
 * `node:querystring`, `node:events`, `node:url`, etc.
 *
 * Console is replaced for the duration of the case, then restored.
 */
import { setProcessCwd } from '@rifty/runtime-js/builtins/process';
import { createModuleLoader } from '@rifty/runtime-js/loader';
import type { TransformSourceHook } from '@rifty/runtime-js/loader';
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@rifty/vfs/internal';
import { formatArgs } from '../../../packages/runtime-js/src/repl/inspect.ts';
// The runner is a `tools/` harness, so reaching into `@rifty/runtime-wasi` and
// the shadow-registry esbuild binding is layer-legal (same precedent as the
// `kind: 'http'` mode importing `@rifty/net`). We pull `runWasi` from the
// runtime-wasi index and `transformWithEsbuild` from the binding *source*
// (the package index does not re-export the binding). Relative source paths
// mirror the existing `formatArgs` import above and avoid adding workspace
// dependencies the runner does not otherwise need.
import { runWasi } from '../../../packages/runtime-wasi/src/index.ts';
import {
  loadVendoredEsbuildWasm,
  transformWithEsbuild,
} from '../../shadow-registry/src/esbuild-binding.ts';
import type { ParityCase } from './types.ts';

/**
 * Normalised shape returned by the injected `__riftyHttpRequest` driver. Both
 * the Node-side (real `http.request`) and the rifty-side (`dispatchToPort`)
 * implementations resolve to this shape so the case `code` can be byte-for-byte
 * identical across runtimes. Mirrored on the Node side in `run-in-node.ts`.
 */
interface RiftyHttpResponse {
  status: number;
  statusText: string;
  contentType: string | null;
  body: string;
}

declare global {
  // `var` is required for a global augmentation — `const`/`let` are not allowed
  // in `declare global`. Injected by `installHttpMode`, cleared on teardown.
  var __riftyHttpRequest:
    | ((port: number, path: string, init?: RequestInit) => Promise<RiftyHttpResponse>)
    | undefined;
}

/**
 * Install (and uninstall) the opt-in `kind: 'http'` net-registration mode.
 *
 * Returns a teardown that removes the injected global and unregisters any ports
 * the case bound, so the process-wide port registry does not leak state across
 * cases. Importing `@rifty/net/register-builtins` is a side-effecting forward
 * import that plugs the `node:http` / `node:net` / `node:https` factories into
 * the shared `@rifty/io` builtin registry — this is what makes
 * `require('node:http')` resolve on the rifty side.
 */
async function installHttpMode(): Promise<() => void> {
  await import('@rifty/net/register-builtins');
  const { dispatchToPort, listPorts, unregisterPort } = await import('@rifty/net/registry');
  globalThis.__riftyHttpRequest = async (port, path, init) => {
    const resp = await dispatchToPort(
      port,
      new Request(`http://preview.local:${port}${path}`, init),
    );
    return {
      status: resp.status,
      statusText: resp.statusText,
      contentType: resp.headers.get('content-type'),
      body: await resp.text(),
    };
  };
  return () => {
    for (const p of listPorts()) unregisterPort(p);
    globalThis.__riftyHttpRequest = undefined;
  };
}

/**
 * Install the opt-in `kind: 'sqlite'` `node:sqlite` registration mode (ADR-0065).
 *
 * Mirrors {@link installHttpMode} for `@rifty/net`'s `node:http`: the side-
 * effecting forward import of `@rifty/net/sqlite/register-builtins` plugs the
 * sql.js-backed `DatabaseSync` factory into the shared `@rifty/io` builtin
 * registry so `require('node:sqlite')` resolves on the rifty side. It THEN
 * awaits `initSqliteEngine()` — the synchronous `DatabaseSync` constructor the
 * case `code` calls needs the WASM engine already brought up (the one async
 * step the otherwise-synchronous surface depends on, ADR-0065 D1). There is no
 * teardown: the registry factory is process-wide and idempotent, and the engine
 * bring-up is memoised, so leaving both in place is correct across cases.
 */
async function installSqliteMode(): Promise<void> {
  await import('@rifty/net/sqlite/register-builtins');
  const { initSqliteEngine } = await import('@rifty/net/sqlite/engine');
  await initSqliteEngine();
}

/**
 * Build the `transformSource` hook for `kind: 'ts-esm'` — the SAME edge the
 * headless opencode harness uses (ADR-0052). It strips types / lowers JSX with
 * the REAL vendored esbuild WASI binary via the injected `runWasi`, selecting
 * the loader purely by extension (`.ts` → `ts`, `.tsx` → `tsx`, `.jsx` → `jsx`)
 * and passing `jsx:'automatic'` for the JSX loaders (matching the design's
 * caller-chosen default; `.ts` needs no jsx flag). The wasm is read once per
 * run; esbuild's stdin transform mounts `workspace` as its sole preopen, so
 * that directory must exist in the global sync mirror (ensured in `runInRifty`).
 */
function buildTsTransform(): TransformSourceHook {
  // `readFileSync` returns `Uint8Array<ArrayBufferLike>`; copy once into a
  // plain-`ArrayBuffer`-backed view so it satisfies `BufferSource` (the binding
  // never sees a `SharedArrayBuffer`). The copy is paid once per run, outside
  // the returned closure.
  const raw = loadVendoredEsbuildWasm();
  const wasm = new Uint8Array(raw.byteLength);
  wasm.set(raw);
  return ({ source, loader, workspace }) =>
    transformWithEsbuild(runWasi, wasm, {
      source,
      loader,
      workspace,
      format: 'esm',
      jsx: loader !== 'ts' ? 'automatic' : undefined,
    }).then((r) => r.code);
}

export async function runInRifty(testCase: ParityCase): Promise<string> {
  const vfs = new MemoryFsSync();
  const files: Record<string, string> = {};
  if (testCase.setup?.files) {
    for (const [rel, content] of Object.entries(testCase.setup.files)) {
      files[`/work/${rel}`] = content;
    }
  }
  const ext = testCase.kind === 'esm' || testCase.kind === 'ts-esm' ? 'mjs' : 'js';
  // `ts-esm` writes the entry (and setup files) as `.ts` so the loader resolves
  // and strips them; every other kind keeps the historical `.js`/`.mjs` ext.
  const entryExt = testCase.kind === 'ts-esm' ? 'ts' : ext;
  files[`/work/main.${entryExt}`] = testCase.code;
  // `ts-esm` needs `/work` to be a `type:module` package scope so the resolver
  // classifies `.ts` as ESM (F02-T1 `detectKind`) and `import()` strips it —
  // otherwise it falls to CJS and `require()` of a `.ts` throws the directed
  // F02-T4 NotImplementedError. The case author never writes this package.json.
  if (testCase.kind === 'ts-esm' && !('/work/package.json' in files)) {
    files['/work/package.json'] = JSON.stringify({ type: 'module' });
  }
  vfs.loadFixture(files);

  // Replace the global sync mirror so `fs.readFileSync` / `fs.writeFileSync`
  // in user code see the case's files instead of bleeding from other cases.
  // Setup files are exposed at '/' so cases can use either bare names (with
  // resolvePath using cwd='/') or absolute paths.
  const fsFiles: Record<string, string> = {};
  if (testCase.setup?.files) {
    for (const [rel, content] of Object.entries(testCase.setup.files)) {
      fsFiles[`/${rel}`] = content;
    }
  }
  // The esbuild WASI transform (ts-esm) mounts the loader `workspace` (= /work)
  // as its sole preopen and resolves it against the GLOBAL sync mirror (the
  // WASI path syscalls read `syncMirror()`, not the loader's own vfs). Mount
  // the /work tree into the mirror too so that preopen directory exists; esbuild
  // only reads the source over stdin, but its Go runtime canonicalises the cwd
  // preopen at startup (ADR-0049), so /work must be a real directory there.
  if (testCase.kind === 'ts-esm') {
    for (const [path, content] of Object.entries(files)) {
      fsFiles[path] = content;
    }
  }
  const fsMirror = new MemoryFsSync();
  fsMirror.loadFixture(fsFiles);
  setSyncMirror(fsMirror);

  // Mirror Node's view: process.cwd() = '/'. Important so `fs.readFileSync('a.txt')`
  // resolves against the same anchor as the Node child running with cwd=tmpdir.
  // Use the runtime's per-Worker cwd cell rather than monkey-patching the
  // `process` object (ADR-0019).
  setProcessCwd('/');

  // `ts-esm` threads the real esbuild type-strip hook (ADR-0052) so `.ts`
  // resolves and its types are stripped before the AST ESM rewrite, with the
  // esbuild guest cwd/preopen pinned to the loader's `/work` workspace.
  const loader =
    testCase.kind === 'ts-esm'
      ? createModuleLoader(vfs, {
          cwd: '/work',
          workspace: '/work',
          transformSource: buildTsTransform(),
        })
      : createModuleLoader(vfs, { cwd: '/work' });

  // Opt-in net mode: register `node:http` and inject the request driver so the
  // case can drive its own server through the port registry (no OS socket).
  const teardownHttp = testCase.kind === 'http' ? await installHttpMode() : null;

  // Opt-in sqlite mode: register `node:sqlite` and bring up the sql.js engine so
  // the synchronous `DatabaseSync` constructor in the case `code` resolves and
  // has its WASM handle ready (ADR-0065). No teardown — see `installSqliteMode`.
  if (testCase.kind === 'sqlite') await installSqliteMode();

  const captured: string[] = [];
  const writeStdout = (...args: unknown[]) => {
    captured.push(`${formatArgs(args)}\n`);
  };
  const writeStderr = (...args: unknown[]) => {
    captured.push(`${formatArgs(args)}\n`);
  };
  const original = {
    log: console.log,
    info: console.info,
    debug: console.debug,
    warn: console.warn,
    error: console.error,
  };
  console.log = writeStdout;
  console.info = writeStdout;
  console.debug = writeStdout;
  console.warn = writeStderr;
  console.error = writeStderr;
  try {
    if (testCase.kind === 'ts-esm') {
      await loader.import('./main.ts', '/work/__entry.ts');
    } else if (testCase.kind === 'esm') {
      await loader.import('./main.mjs', '/work/__entry.mjs');
    } else {
      loader.require('./main.js', '/work/__entry.js');
    }
    if (testCase.kind === 'http') {
      // The http case drives its own server inside `listen`'s callback (a
      // microtask) and prints from the awaited `__riftyHttpRequest` round-trip.
      // Wait until stdout settles (no new line for two successive polls) rather
      // than a fixed sleep, so a slow round-trip is not silently truncated.
      let prev = -1;
      for (let i = 0; i < 40 && prev !== captured.length; i++) {
        prev = captured.length;
        await new Promise((r) => setTimeout(r, 5));
      }
    } else {
      // Drain microtasks + short setTimeout used in async cases. 25ms covers
      // any 1ms setTimeout in cases; a real bug here wouldn't be hidden by
      // waiting longer.
      await new Promise((r) => setTimeout(r, 25));
    }
  } finally {
    console.log = original.log;
    console.info = original.info;
    console.debug = original.debug;
    console.warn = original.warn;
    console.error = original.error;
    resetSyncMirror();
    setProcessCwd('/workspace');
    teardownHttp?.();
  }
  return captured.join('');
}
