/// <reference lib="webworker" />
/**
 * Worker-side entry point for the JS runtime.
 *
 * Boot is async (ADR-0072): a `boot` promise `await initBackend()` to select
 * the VFS backend (OPFS when cross-origin-isolated, else in-memory) and build
 * the module loader, then posts `{ type: 'ready' }`. The message listener is
 * attached synchronously and each `eval`/`load-fixture` awaits `boot`, so a
 * request the host posts before readiness is handled once the backend is wired,
 * never dropped. It accepts:
 *   - `eval` requests (code -> stdout/stderr/result events)
 *   - `load-fixture` (preload files into the active VFS via the sync mirror)
 *   - `ping` (responds with `pong`)
 *
 * On boot it also installs Node-compatible globals (`process`, `Buffer`,
 * `setImmediate`/`clearImmediate`) so user code that expects them just works.
 */

import { initBackend, syncMirror } from '@rifty/vfs';
import { installMemoryFs } from '@rifty/vfs/internal';
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
  } finally {
    // Drain OPFS write-through (ADR-0072) before the eval result is posted,
    // so a file written during eval is durably persisted before the host can
    // resolve the eval promise (and, in the e2e, before a page reload). On
    // the memory backend `flush` is absent and this is a no-op.
    const mirror = syncMirror() as { flush?: () => Promise<void> };
    if (typeof mirror.flush === 'function') {
      await mirror.flush();
    }
  }
}

// Async boot (ADR-0072). The VFS backend selection (OPFS vs memory) is async, so
// the module loader + REPL bindings are built behind the `boot` promise.
//
// The message listener is attached SYNCHRONOUSLY (below `boot`) so an `eval` /
// `load-fixture` the host posts before the backend is wired is RECEIVED
// immediately and handled once `boot` resolves — never dropped. This matters
// because the playground REPL types into the terminal WITHOUT first waiting for
// the '[worker ready]' marker, so an early eval must queue, not vanish. `ready`
// is posted only after `boot` resolves, so a write performed *after* the marker
// (the OPFS round-trip e2e) lands on the wired backend.
const boot = (async () => {
  try {
    await initBackend();
  } catch (err) {
    // OPFS init failed for this realm — degrade to in-memory so the runtime
    // still boots (mirrors the playground's bootstrap fallback). Persistence is
    // lost but eval keeps working; the original worker was memory-only anyway.
    const reason = err instanceof Error ? err.message : String(err);
    post({ type: 'stderr', chunk: `[rifty] VFS backend init failed, using memory: ${reason}\n` });
    installMemoryFs();
  }

  // Build the loader from the active sync mirror (ADR-0014 + ADR-0037 +
  // ADR-0072): `node:fs` reads `syncMirror()` live, and the loader captures this
  // same instance — both see the one OPFS (or memory) tree for this Worker
  // realm. `load-fixture` writes flow through the active mirror.
  const active = syncMirror();
  const loader = createModuleLoader(active, { cwd: '/' });

  // Install REPL bindings once: the loader is long-lived. The canonical home is
  // `__rifty.require` / `__rifty.import`; we also mirror onto `self.require` /
  // `self.__riftyImport` for Node-style REPL ergonomics (existing M2 e2e cases).
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

  installConsole(sink);
  return loader;
})();

self.addEventListener('message', async (event: MessageEvent<HostMessage>) => {
  const msg = event.data;
  // `ping` is a liveness probe — answer immediately, no backend needed.
  if (msg.type === 'ping') {
    post({ type: 'pong' });
    return;
  }
  // `eval` and `load-fixture` need the wired backend + loader. Awaiting `boot`
  // here is what lets an eval posted before readiness run (against the wired
  // OPFS/memory tree) instead of being lost.
  const loader = await boot;
  switch (msg.type) {
    case 'load-fixture': {
      // Keep the loader instance alive across editor saves and only drop the
      // module cache; the resolver and REPL bindings survive. Route through the
      // active mirror (ADR-0072) so editor saves land on the wired backend, not
      // a dead memory instance (`loadFixture` is optional on the FsSync surface;
      // memory + OPFS both provide it).
      const mirror = syncMirror();
      if (typeof mirror.loadFixture === 'function') {
        mirror.loadFixture(msg.files);
      }
      loader.invalidate();
      break;
    }
    case 'eval': {
      const result = await handleEval(msg.request);
      post({ type: 'result', result });
      break;
    }
  }
});

void boot.then(() => post({ type: 'ready' }));
