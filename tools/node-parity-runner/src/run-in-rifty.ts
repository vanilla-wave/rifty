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
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@rifty/vfs/internal';
import { formatArgs } from '../../../packages/runtime-js/src/repl/inspect.ts';
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

export async function runInRifty(testCase: ParityCase): Promise<string> {
  const vfs = new MemoryFsSync();
  const files: Record<string, string> = {};
  if (testCase.setup?.files) {
    for (const [rel, content] of Object.entries(testCase.setup.files)) {
      files[`/work/${rel}`] = content;
    }
  }
  const ext = testCase.kind === 'esm' ? 'mjs' : 'js';
  files[`/work/main.${ext}`] = testCase.code;
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
  const fsMirror = new MemoryFsSync();
  fsMirror.loadFixture(fsFiles);
  setSyncMirror(fsMirror);

  // Mirror Node's view: process.cwd() = '/'. Important so `fs.readFileSync('a.txt')`
  // resolves against the same anchor as the Node child running with cwd=tmpdir.
  // Use the runtime's per-Worker cwd cell rather than monkey-patching the
  // `process` object (ADR-0019).
  setProcessCwd('/');

  const loader = createModuleLoader(vfs, { cwd: '/work' });

  // Opt-in net mode: register `node:http` and inject the request driver so the
  // case can drive its own server through the port registry (no OS socket).
  const teardownHttp = testCase.kind === 'http' ? await installHttpMode() : null;

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
    if (testCase.kind === 'esm') {
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
