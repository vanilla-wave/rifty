/**
 * Run case code through the rifty module loader and capture stdout.
 *
 * Scope: the loader is the rifty path under test. We deliberately do NOT
 * monkey-patch global `process` or `Promise.prototype.then` here — that would
 * leak into the runner itself. Behaviours that depend on rifty's promise/
 * nextTick patches are covered by the conformance suite, which can install
 * the patches in a controlled `beforeAll`/`afterAll` scope. The parity runner
 * does temporarily mirror the Worker's tracked timer globals so detached timer
 * chains participate in the real keepalive drain. It otherwise focuses on
 * module-shape semantics: `node:path`, `node:buffer`, `node:util`,
 * `node:querystring`, `node:events`, `node:url`, etc.
 *
 * Console is replaced for the duration of the case, then restored.
 */
import {
  resetRiftyProcessStdinForTest,
  riftyProcess,
  setProcessCwd,
  writeProcessStdin,
} from '@riftydev/runtime-js/builtins/process';
import { installTimerGlobals } from '@riftydev/runtime-js/builtins/timers';
import { createModuleLoader } from '@riftydev/runtime-js/loader';
import type { TransformSourceHook } from '@riftydev/runtime-js/loader';
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
// vm-engine relative source imports (same `tools/`-harness precedent as
// `formatArgs` below): `setVmEngineOverride` lets the runner reset the engine
// selection between cases, and `ensureVmEngineReady` preloads the QuickJS WASM
// module once so a case opting into the `quickjs` engine (via
// `globalThis.__RIFTY_VM_ENGINE`) can run `vm.*` SYNCHRONOUSLY (the engine reads
// `getQuickJsModuleSync()`). Both are memoised/idempotent — one-time cost.
import { setVmEngineOverride } from '../../../packages/runtime-js/src/builtins/vm/engine-config.ts';
import { ensureVmEngineReady } from '../../../packages/runtime-js/src/builtins/vm/quickjs-loader.ts';
import {
  awaitDrain,
  resetKeepalive,
} from '../../../packages/runtime-js/src/internal/event-loop-keepalive.ts';
import { formatArgs } from '../../../packages/runtime-js/src/repl/inspect.ts';
// The runner is a `tools/` harness, so reaching into `@riftydev/runtime-wasi` and
// the shadow-registry esbuild binding is layer-legal (same precedent as the
// `kind: 'http'` mode importing `@riftydev/net`). We pull `runWasi` from the
// runtime-wasi index and `transformWithEsbuild` from the binding *source*
// (the package index does not re-export the binding). Relative source paths
// mirror the existing `formatArgs` import above and avoid adding workspace
// dependencies the runner does not otherwise need.
import { runWasi } from '../../../packages/runtime-wasi/src/index.ts';
import {
  loadVendoredEsbuildWasm,
  transformWithEsbuild,
} from '../../shadow-registry/src/esbuild-binding.ts';
import { type ParityCase, caseCwd } from './types.ts';

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

const TIMER_GLOBAL_KEYS = [
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'setImmediate',
  'clearImmediate',
] as const;

/** Mirror worker bootstrap timers for one case, then restore the harness realm exactly. */
function installCaseTimerGlobals(): () => void {
  const globals = globalThis as unknown as Record<string, unknown>;
  const previous = TIMER_GLOBAL_KEYS.map((key) => ({
    key,
    own: Object.hasOwn(globals, key),
    value: globals[key],
  }));
  installTimerGlobals();
  return () => {
    for (const { key, own, value } of previous) {
      if (own) globals[key] = value;
      else Reflect.deleteProperty(globals, key);
    }
  };
}

/**
 * Install (and uninstall) the opt-in `kind: 'http'` net-registration mode.
 *
 * Returns a teardown that removes the injected global and unregisters any ports
 * the case bound, so the process-wide port registry does not leak state across
 * cases. Importing `@riftydev/net/register-builtins` is a side-effecting forward
 * import that plugs the `node:http` / `node:net` / `node:https` factories into
 * the shared `@riftydev/io` builtin registry — this is what makes
 * `require('node:http')` resolve on the rifty side.
 */
async function installHttpMode(): Promise<() => void> {
  await import('@riftydev/net/register-builtins');
  const { dispatchToPort, listPorts, unregisterPort } = await import('@riftydev/net/registry');
  // The cross-realm bind-claim (ADR-0186) defers `listen()`'s `'listening'`/cb by
  // a window so a sibling realm can deny. The parity harness is single-realm (no
  // denier), and these cases issue the request INSIDE the listen callback — run
  // the claim at 0 so the cb fires within the harness host-timer grace instead of
  // after `__riftyHttpRequest` is cleared. Restored on teardown.
  const { getDefaultClaimWindowMs, setDefaultClaimWindowMs, releasePort } = await import(
    '@riftydev/net'
  );
  const prevClaimWindow = getDefaultClaimWindowMs();
  setDefaultClaimWindowMs(0);
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
    // Mirror close(): release the bind-claim AND unregister, so the owner-answerer
    // does not linger and falsely deny a later case that reuses the port.
    for (const p of listPorts()) {
      releasePort(p);
      unregisterPort(p);
    }
    setDefaultClaimWindowMs(prevClaimWindow);
    globalThis.__riftyHttpRequest = undefined;
  };
}

/**
 * Install the opt-in `kind: 'sqlite'` `node:sqlite` registration mode (ADR-0065).
 *
 * Mirrors {@link installHttpMode} for `@riftydev/net`'s `node:http`: the side-
 * effecting forward import of `@riftydev/net/sqlite/register-builtins` plugs the
 * sql.js-backed `DatabaseSync` factory into the shared `@riftydev/io` builtin
 * registry so `require('node:sqlite')` resolves on the rifty side. It THEN
 * awaits `initSqliteEngine()` — the synchronous `DatabaseSync` constructor the
 * case `code` calls needs the WASM engine already brought up (the one async
 * step the otherwise-synchronous surface depends on, ADR-0065 D1). There is no
 * teardown: the registry factory is process-wide and idempotent, and the engine
 * bring-up is memoised, so leaving both in place is correct across cases.
 */
async function installSqliteMode(): Promise<void> {
  await import('@riftydev/net/sqlite/register-builtins');
  const { initSqliteEngine } = await import('@riftydev/net/sqlite/engine');
  await initSqliteEngine();
}

/**
 * Install the opt-in `kind: 'exec-sync'` mode (ADR-0084 #23, ADR-0137).
 * `execSync` is SAB-only by design (ADR-0011 removed the in-realm fallback as a
 * silent stub), so the default loader path throws `NotImplementedError`. To
 * exercise the v2 binary-frame round-trip head-to-head against real Node's
 * byte-exact `execSync`, this wires a REAL kernel `SabRing` + the genuine
 * encode/decodeReply framing and a SYNCHRONOUS in-realm child runner that
 * captures stdout BYTES, then publishes the `__riftyKernelSyncCall` shim the
 * runtime-js `execSync` reads.
 *
 * The child runner LOADER-RUNS the script through the REAL rifty module loader
 * (ADR-0137) — `loader.require` for a CJS entry — so the child's `#!` shebang is
 * stripped (the resolver's strip, `resolver.ts`), its relative `require('./x')`
 * resolves against the sync mirror, and a sibling `fs.readFileSync('./y')` reads
 * the mirror (the rifty `node:fs` builtin). This is the same loader path the
 * browser `kind:'url'` child uses — the OLD `new Function` runner could do NONE
 * of these (it threw on `#!`, could not resolve relatives), so it silently
 * diverged from real Node for any shebang'd / relative-import child. Closing
 * that is the whole point of this item (Fidelity).
 *
 * Synchronous by design: `execSync`'s `api.call(...)` must return without
 * yielding (it is the synchronous child-execution contract). `loader.require`
 * runs a CJS entry to completion synchronously, so `pumpOnce` services the
 * request and `waitReply` finds the reply immediately — matching the OLD mock's
 * synchronous shape, now over the loader instead of `new Function`. (An ESM
 * execSync child is async-only; the in-process-runner unit test + the browser
 * e2e cover the ESM/`kind:'url'` paths — this synchronous parity mock pins the
 * CJS shebang/relative/sibling-read behaviors head-to-head against Node.)
 * Returns a teardown that clears the published shim + the host-capability stubs.
 */
async function installExecSyncMode(): Promise<() => void> {
  // Relative source imports (same `tools/`-harness precedent as `runWasi` above):
  // kernel and the runtime-js loader are not workspace deps of the runner.
  const {
    SabRing,
    createSabRing,
    encodeRequest,
    decodeReply,
    SyncRpcDispatcher,
    publishKernelSyncApi,
    setKernelWorkerUrl,
  } = await import('../../../packages/kernel/src/index.ts');
  const { syncMirror } = await import(
    '../../../packages/runtime-js/src/builtins/fs-sync-mirror.ts'
  );
  const { createModuleLoader } = await import(
    '../../../packages/runtime-js/src/module-loader/loader.ts'
  );
  const { riftyProcess } = await import('../../../packages/runtime-js/src/builtins/process.ts');
  const { isAbsolute, joinPath, normalizePath } = await import('@riftydev/vfs');

  // Capability stubs so runtime-js `execSync` takes the SAB branch. SAB +
  // Atomics already exist in Node; only `crossOriginIsolated` is missing.
  const g = globalThis as typeof globalThis & { crossOriginIsolated?: boolean };
  const hadCOI = 'crossOriginIsolated' in g ? g.crossOriginIsolated : undefined;
  Object.defineProperty(g, 'crossOriginIsolated', { value: true, configurable: true });
  setKernelWorkerUrl('parity://exec-sync');
  // Untyped view for swapping the ambient `process` to `riftyProcess` during a
  // child run (Node's `Process` type rejects the `NodeProcess` shim assignment).
  const procHost = globalThis as { process?: unknown };

  /**
   * Synchronous loader-run child runner (ADR-0137). Loads the CJS entry through
   * the REAL rifty loader against the sync mirror — shebang stripped, relative
   * `require` + sibling `fs.readFileSync` resolved — capturing the child's
   * `process.stdout.write(...)` bytes verbatim (byte-exact, ADR-0084 #23). The
   * loader reads the ambient global `process`; we install `riftyProcess` with a
   * capturing `stdout` for the run (the Worker realm shape, scoped) and restore.
   */
  function runChildSync(
    scriptPath: string,
    cwd: string,
  ): {
    stdout: Uint8Array;
    exitCode: number;
  } {
    const chunks: Uint8Array[] = [];
    const enc = new TextEncoder();
    const capture = {
      write(chunk: unknown): boolean {
        if (chunk instanceof Uint8Array) chunks.push(new Uint8Array(chunk));
        else chunks.push(enc.encode(String(chunk)));
        return true;
      },
      isTTY: false,
      fd: 1,
    };
    const prevGlobalProcess = procHost.process;
    const prevStdout = riftyProcess.stdout;
    const prevExitCode = riftyProcess.exitCode;
    (riftyProcess as { stdout: unknown }).stdout = capture;
    riftyProcess.exitCode = 0;
    procHost.process = riftyProcess;
    let exitCode = 0;
    try {
      const loader = createModuleLoader(syncMirror(), { cwd });
      // Absolutize the entry against cwd (the loader treats bare `build.js` as a
      // package specifier — Node-faithful), mirroring the handler's
      // `resolveNodeEntry`; real Node runs the child in the case tmpdir cwd.
      const entryAbs = normalizePath(
        isAbsolute(scriptPath) ? scriptPath : joinPath(cwd, scriptPath),
      );
      loader.require(entryAbs, entryAbs);
      exitCode = riftyProcess.exitCode;
    } catch {
      exitCode = riftyProcess.exitCode || 1;
    } finally {
      procHost.process = prevGlobalProcess;
      (riftyProcess as { stdout: unknown }).stdout = prevStdout;
      riftyProcess.exitCode = prevExitCode;
    }
    let total = 0;
    for (const c of chunks) total += c.byteLength;
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.byteLength;
    }
    return { stdout: out, exitCode };
  }

  // Real dispatcher + ring + framing. The synchronous handler returns the
  // child's stdout BYTES — the dispatcher emits a v2 binary frame (ADR-0084
  // #23), so the value round-trips byte-exact.
  const dispatcher = new SyncRpcDispatcher();
  dispatcher.register('execSync', (rawPayload) => {
    const payload = rawPayload as { cmd: string; opts?: { cwd?: string } };
    const tokens = payload.cmd.split(/\s+/).filter(Boolean);
    if (tokens[0] !== 'node' || tokens.length < 2) {
      throw Object.assign(new Error(`execSync only supports 'node <script>': ${payload.cmd}`), {
        code: 'EUNSUPPORTED',
      });
    }
    const cwd = payload.opts?.cwd ?? '/';
    const rawArg = tokens[1] ?? '';
    const scriptPath = normalizePath(isAbsolute(rawArg) ? rawArg : joinPath(cwd, rawArg));
    if (!syncMirror().existsSync(scriptPath)) {
      throw Object.assign(new Error(`execSync: script not found: ${scriptPath}`), {
        code: 'ENOENT',
      });
    }
    const result = runChildSync(scriptPath, cwd);
    if (result.exitCode !== 0) {
      throw Object.assign(new Error(`Command failed: ${payload.cmd}`), {
        code: 'ECHILDFAILED',
        exitCode: result.exitCode,
      });
    }
    return result.stdout;
  });

  const { sab, ring } = createSabRing();
  const dispatcherRing = SabRing.attach(sab);
  dispatcher.attach(dispatcherRing);

  publishKernelSyncApi({
    call: (method, payload) => {
      ring.writeRequest(encodeRequest({ method, payload }));
      dispatcher.pumpOnce(dispatcherRing); // synchronous handler writes the reply now
      const replyBytes = ring.waitReply(2000); // reply already present → returns immediately
      const reply = decodeReply(replyBytes);
      if (reply.ok) return reply.value;
      const e = reply.error ?? { name: 'Error', message: 'unknown' };
      const err = new Error(e.message);
      err.name = e.name;
      if (e.code !== undefined) (err as Error & { code?: string }).code = e.code;
      throw err;
    },
  });

  return () => {
    dispatcher.detachAll();
    Object.defineProperty(g, '__riftyKernelSyncCall', { value: undefined, configurable: true });
    if (hadCOI === undefined) {
      Reflect.deleteProperty(g, 'crossOriginIsolated');
    } else {
      Object.defineProperty(g, 'crossOriginIsolated', { value: hadCOI, configurable: true });
    }
    setKernelWorkerUrl('');
  };
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
      sourcemap: 'inline',
      supported: { decorators: false },
      jsx: loader !== 'ts' ? 'automatic' : undefined,
    }).then((r) => r.code);
}

export async function runInRifty(testCase: ParityCase): Promise<string> {
  // Real Node gets a fresh stdin stream in every spawned parity child. This
  // in-process harness reuses the no-spec process singleton, so recreate stdin
  // at the same case boundary (decoder + flow + EOF + listeners as one unit).
  resetRiftyProcessStdinForTest();
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
  // Materialize the case cwd: the Node runner mkdirs `<workDir>/<cwd>` before
  // spawning, so a cwd with no setup files inside it must exist here too
  // (self-proof: cases/fs/empty-cwd-materialized).
  const cwd = caseCwd(testCase);
  if (cwd !== '/') fsMirror.mkdirSync(cwd, { recursive: true });
  setSyncMirror(fsMirror);

  // Mirror Node's view: process.cwd() = ParityCase.cwd (default '/'). Important
  // so `fs.readFileSync('a.txt')` resolves against the same anchor as the Node
  // child running with cwd=<workDir>/<cwd>. Use the runtime's per-Worker cwd
  // cell rather than monkey-patching the `process` object (ADR-0019).
  setProcessCwd(cwd);

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

  // Opt-in exec-sync mode (ADR-0084 #23): wire the real SAB binary-frame path so
  // the case's `child_process.execSync` returns byte-exact stdout to diff against
  // real Node. Teardown clears the published shim + host-capability stubs.
  const teardownExecSync = testCase.kind === 'exec-sync' ? await installExecSyncMode() : null;

  // Preload QuickJS before any user code runs: a case can opt the `vm.*` sandbox
  // into the quickjs engine via `globalThis.__RIFTY_VM_ENGINE = 'quickjs'`, and
  // that engine evaluates synchronously via `getQuickJsModuleSync()`. Memoised,
  // so this is a one-time bring-up shared across all cases.
  await ensureVmEngineReady();

  // The runner evaluates cases IN-PROCESS, so the `vm` engine selection — driven
  // by `globalThis.__RIFTY_VM_ENGINE` (e.g. a case opting into 'quickjs') and the
  // explicit override — must not leak into the next case. Snapshot here, restore
  // in `finally`. Default stays rewrite for every case that does not opt in.
  const priorVmEngineGlobal = (globalThis as Record<string, unknown>).__RIFTY_VM_ENGINE;
  const restoreTimerGlobals = installCaseTimerGlobals();

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
    if (testCase.stdin) {
      for (const chunk of testCase.stdin) writeProcessStdin(chunk);
      riftyProcess.stdin.push(null);
    }
    // Mirror the real Worker lifecycle: global timers installed by bootstrap
    // hold the keepalive refcount until every scheduled callback has fired.
    await awaitDrain({ capMs: 1000 });
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
    }
  } finally {
    console.log = original.log;
    console.info = original.info;
    console.debug = original.debug;
    console.warn = original.warn;
    console.error = original.error;
    restoreTimerGlobals();
    resetSyncMirror();
    resetKeepalive();
    setProcessCwd('/workspace');
    teardownHttp?.();
    teardownExecSync?.();
    // Restore the vm-engine selection so an opt-in case does not poison the next.
    (globalThis as Record<string, unknown>).__RIFTY_VM_ENGINE = priorVmEngineGlobal;
    setVmEngineOverride(undefined);
  }
  return captured.join('');
}
