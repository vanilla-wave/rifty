/// <reference lib="webworker" />
/**
 * Worker-side entry point for the JS runtime.
 *
 * On boot it posts `{ type: 'ready' }`. From then on it accepts:
 *   - `eval` requests (code -> stdout/stderr/result events)
 *   - `load-fixture` (preload files into the worker-local in-memory VFS)
 *   - `ping` (responds with `pong`)
 *
 * On boot it also installs Node-compatible globals (`process`, `Buffer`,
 * `setImmediate`/`clearImmediate`) so user code that expects them just works.
 */

import { createMemoryFs, setSyncMirror } from '@rifty/vfs/internal';
import { Buffer } from './builtins/buffer.ts';
import { __setCreateRequireImpl } from './builtins/module.ts';
import { installProcessGlobals, setProcessCwd } from './builtins/process.ts';
import { installTimerGlobals } from './builtins/timers.ts';
import { publishRuntimeGlobal } from './internal/worker-globals.ts';
import { createModuleLoader } from './module-loader/index.ts';
import type { EvalRequest, EvalResult, HostMessage, WorkerMessage } from './protocol.ts';
import { installConsole } from './repl/console.ts';
import { evalInRepl } from './repl/eval.ts';
import { inspect } from './repl/inspect.ts';

declare const self: DedicatedWorkerGlobalScope;

installProcessGlobals();
installTimerGlobals();
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;

// Single in-memory tree (ADR-0014 + ADR-0037): the same `MemoryFsSync` view
// answers `fs.readFileSync` (via `syncMirror()`), the module loader
// (resolver + executor), and the WASI preopens. `load-fixture` writes flow
// into the shared `MemoryBackend`, so a file dropped in by the host is
// visible to every consumer in this Worker realm.
const { vfs: asyncView, fsSync: vfs } = createMemoryFs();
setSyncMirror(vfs, { async: asyncView });
const loader = createModuleLoader(vfs, { cwd: '/' });

// Install REPL bindings once: the loader is now long-lived (see ADR follow-up
// for D-E in `docs/review/2026-05-26-architecture-review.md`). Past versions
// rebuilt the loader on every `load-fixture`, which forced this rebind because
// the old closure captured a stale reference. With `loader.invalidate()`
// keeping the same instance, one bind at boot is enough.
//
// Storage is governed by the owner table (`internal/worker-globals.ts`,
// closes the "Ungoverned globals" Tier 2 #10 finding from the 2026-05-26
// architecture review). The canonical home is `__rifty.require` /
// `__rifty.import`; we additionally mirror the values onto `self.require`
// and `self.__riftyImport` so user code typed at the REPL keeps the
// existing Node-style `require(...)` / `__riftyImport(...)` ergonomics
// (covered by the existing M2 e2e cases).
const replRequire = (specifier: string): unknown => loader.require(specifier, '/__repl__.js');
const replImport = (specifier: string): Promise<unknown> =>
  loader.import(specifier, '/__repl__.js');
publishRuntimeGlobal('require', replRequire);
publishRuntimeGlobal('import', replImport);
(self as unknown as { require: typeof replRequire }).require = replRequire;
(self as unknown as { __riftyImport: typeof replImport }).__riftyImport = replImport;
// Hook node:module's createRequire to the live loader.
__setCreateRequireImpl((from: string) => {
  const req = (id: string) => loader.require(id, from);
  return req as ((id: string) => unknown) & {
    resolve?: (id: string) => string;
    cache?: Record<string, unknown>;
  };
});

function post(msg: WorkerMessage): void {
  self.postMessage(msg);
}

const sink = {
  stdout(chunk: string) {
    post({ type: 'stdout', chunk });
  },
  stderr(chunk: string) {
    post({ type: 'stderr', chunk });
  },
};
installConsole(sink);

async function handleEval(req: EvalRequest): Promise<EvalResult> {
  // ADR-0019 — when the host attaches `cwd` to the eval request (e.g. the
  // kernel propagating a `ProcessRecord.cwd` snapshot at spawn time), seed
  // the per-Worker cwd cell before running user code. `setProcessCwd`
  // bypasses VFS validation: the host is trusted to pass a path that's
  // already been resolved against the active record.
  if (req.cwd !== undefined) {
    setProcessCwd(req.cwd);
  }
  try {
    const value = await evalInRepl(req.code);
    if (value !== undefined) {
      post({ type: 'stdout', chunk: `${inspect(value)}\n` });
    }
    return { id: req.id, ok: true, value: undefined };
  } catch (err) {
    if (err instanceof Error) {
      post({ type: 'stderr', chunk: `${err.stack ?? `${err.name}: ${err.message}`}\n` });
      const result: EvalResult = {
        id: req.id,
        ok: false,
        error: { name: err.name, message: err.message, stack: err.stack ?? '' },
      };
      return result;
    }
    const message = String(err);
    post({ type: 'stderr', chunk: `${message}\n` });
    return { id: req.id, ok: false, error: { name: 'Error', message } };
  }
}

self.addEventListener('message', async (event: MessageEvent<HostMessage>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'ping':
      post({ type: 'pong' });
      break;
    case 'load-fixture':
      // Per the 2026-05-26 architecture review (Tier 1 #4 / D-E): keep the
      // loader instance alive across editor saves and only drop the module
      // cache. The resolver and REPL bindings survive, which is invisible at
      // M2 but a prerequisite for HMR-style hot paths in M10/M11. Granular
      // single-file invalidation is available via `loader.invalidate(id)` —
      // not used from here today; the message protocol still posts the full
      // fixture, so full reset matches what the host actually communicates.
      vfs.loadFixture(msg.files);
      loader.invalidate();
      break;
    case 'eval': {
      const result = await handleEval(msg.request);
      post({ type: 'result', result });
      break;
    }
  }
});

post({ type: 'ready' });
