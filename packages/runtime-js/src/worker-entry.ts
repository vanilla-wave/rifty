/// <reference lib="webworker" />
/**
 * Worker-side entry point for the JS runtime.
 *
 * Boot is async (ADR-0072): a `boot` promise awaits `initBackend()` (OPFS when
 * cross-origin-isolated, else in-memory) and builds the module loader, then
 * posts `ready`. The message listener is attached synchronously and each
 * `eval`/`load-fixture` awaits `boot`, so a request posted before readiness is
 * handled once the backend is wired, never dropped. Accepts:
 *   - `eval` (code -> stdout/stderr/result events)
 *   - `load-fixture` (preload files into the active VFS via the sync mirror)
 *   - `ping` (responds with `pong`)
 *
 * Boot also installs Node-compatible globals (`process`, `Buffer`, timers).
 */

import { initBackend, syncMirror } from '@riftydev/vfs';
import { installMemoryFs } from '@riftydev/vfs/internal';
import { Buffer } from './builtins/buffer.ts';
import { installProcessGlobals, setProcessCwd, writeProcessStdin } from './builtins/process.ts';
import { installTimerGlobals } from './builtins/timers.ts';
import { setVmEngineOverride } from './builtins/vm/engine-config.ts';
import { ensureVmEngineReady } from './builtins/vm/quickjs-loader.ts';
import { installWebGlobals } from './builtins/web-globals.ts';
import { publishRuntimeGlobal } from './internal/worker-globals.ts';
import { createModuleLoader } from './module-loader/index.ts';
import type { EvalRequest, EvalResult, HostMessage, WorkerMessage } from './protocol.ts';
import { installConsole } from './repl/console.ts';
import { evalInRepl } from './repl/eval.ts';
import { inspect } from './repl/inspect.ts';
import { captureNotImplemented, snapshotTelemetry } from './telemetry/divergence-sink.ts';
import { handleWorkerFsRequest } from './worker-fs-rpc.ts';

declare const self: DedicatedWorkerGlobalScope;

installProcessGlobals();
installTimerGlobals();
installWebGlobals();
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

// Post a `diagnostic` telemetry snapshot only when it CHANGED since the last
// post (T15) — keeps the cadence non-spammy. JSON identity is the cheap
// change-detector for the small dev-only snapshot; the host surfaces it for the
// playground divergence panel (T16).
let lastDiagnostic = '';
function postDiagnosticIfChanged(): void {
  const payload = snapshotTelemetry();
  if (payload.length === 0) return;
  const serialized = JSON.stringify(payload);
  if (serialized === lastDiagnostic) return;
  lastDiagnostic = serialized;
  post({ type: 'diagnostic', payload });
}

async function handleEval(req: EvalRequest): Promise<EvalResult> {
  // ADR-0019 — seed the per-Worker cwd cell from the host's eval `cwd` snapshot
  // (kernel's ProcessRecord.cwd) before running user code. `setProcessCwd`
  // bypasses VFS validation: the host is trusted to pass an already-resolved path.
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
    // Boundary telemetry (T15): a NotImplementedError surfacing here is a real
    // capability gap — record it (matched by name; io + vfs both define the class).
    captureNotImplemented(err);
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
    // Drain OPFS write-through (ADR-0072) before posting the result, so a file
    // written during eval is durably persisted before the host resolves the eval
    // promise (e2e: before a page reload). No-op on memory (`flush` absent).
    const mirror = syncMirror() as { flush?: () => Promise<void> };
    if (typeof mirror.flush === 'function') {
      await mirror.flush();
    }
  }
}

// Async boot (ADR-0072): VFS backend selection (OPFS vs memory) is async, so the
// loader + REPL bindings are built behind `boot`. The message listener attaches
// SYNCHRONOUSLY (below) so an early `eval`/`load-fixture` is received and handled
// once `boot` resolves — the playground REPL types without waiting for the
// '[worker ready]' marker, so an early eval must queue, not vanish. `ready` is
// posted only after `boot` resolves, so a post-marker write (OPFS round-trip
// e2e) lands on the wired backend.
const boot = (async () => {
  try {
    await initBackend();
  } catch (err) {
    // OPFS init failed for this realm — degrade to in-memory so the runtime still
    // boots (mirrors the playground bootstrap fallback). Persistence is lost but
    // eval keeps working.
    const reason = err instanceof Error ? err.message : String(err);
    post({ type: 'stderr', chunk: `[rifty] VFS backend init failed, using memory: ${reason}\n` });
    installMemoryFs();
  }

  // Preload the QuickJS WASM engine into the boot promise (ADR-0142) so a
  // SYNCHRONOUS `vm.*` sandbox call in evaled code always finds the engine ready
  // (`getQuickJsModuleSync`). Eval awaits `boot`, so an early eval calling
  // `vm.runInNewContext` is safe. On preload failure, log + continue — the
  // opt-in rewrite engine still works without QuickJS.
  try {
    await ensureVmEngineReady();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    post({ type: 'stderr', chunk: `[rifty] QuickJS vm engine preload failed: ${reason}\n` });
  }

  // Build the loader from the active sync mirror (ADR-0014 + ADR-0037 +
  // ADR-0072): `node:fs` reads `syncMirror()` live and the loader captures the
  // same instance, so both see the one OPFS (or memory) tree for this realm.
  const active = syncMirror();
  const loader = createModuleLoader(active, { cwd: '/' });

  // Canonical home is `__rifty.require`/`__rifty.import`; also mirrored onto
  // `self.require`/`self.__riftyImport` for Node-style REPL ergonomics (M2 e2e).
  const replRequire = (specifier: string): unknown => loader.require(specifier, '/__repl__.js');
  const replImport = (specifier: string): Promise<unknown> =>
    loader.import(specifier, '/__repl__.js');
  publishRuntimeGlobal('require', replRequire);
  publishRuntimeGlobal('import', replImport);
  (self as unknown as { require: typeof replRequire }).require = replRequire;
  (self as unknown as { __riftyImport: typeof replImport }).__riftyImport = replImport;

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
  if (msg.type === 'stdin') {
    writeProcessStdin(msg.data);
    return;
  }
  // Programmatic `node:vm` engine override (ADR-0142). Synchronous — no backend
  // needed; takes precedence over the `__RIFTY_VM_ENGINE` env in resolveVmEngineName.
  if (msg.type === 'vm-config') {
    setVmEngineOverride(msg.engine);
    return;
  }
  // `eval`/`load-fixture` need the wired backend + loader. Awaiting `boot` lets
  // an eval posted before readiness run against the wired tree instead of being lost.
  const loader = await boot;
  switch (msg.type) {
    case 'load-fixture': {
      // Keep the loader alive across editor saves, dropping only the module cache.
      // Route writes through the active mirror (ADR-0072) so saves land on the
      // wired backend, not a dead memory instance (`loadFixture` is optional on
      // FsSync; memory + OPFS both provide it).
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
      // After an eval that may have recorded a divergence (rewrite engine) or a
      // NotImplemented hit, surface the snapshot — only when it CHANGED (T15).
      postDiagnosticIfChanged();
      break;
    }
    case 'fs': {
      const result = await handleWorkerFsRequest(msg.request, {
        fs: syncMirror(),
        invalidate: () => loader.invalidate(),
        flush: async () => {
          const mirror = syncMirror() as { flush?: () => Promise<void> };
          if (typeof mirror.flush === 'function') await mirror.flush();
        },
      });
      post({ type: 'fs-result', result });
      break;
    }
  }
});

void boot.then(() => post({ type: 'ready' }));
