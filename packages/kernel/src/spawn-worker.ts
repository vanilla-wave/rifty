/**
 * Kernel-side `spawnWorker` (ADR-0011 phase 2).
 *
 * Allocates a Web Worker per spawned process. The kernel:
 *   1. Picks a PID via the same monotonic counter `ProcessManager.spawn` uses
 *      so PID space stays unified.
 *   2. Creates a {@link SabRing} for sync IPC and three `MessageChannel`s for
 *      stdio (stdout / stderr / stdin).
 *   3. Constructs `new Worker(kernelWorkerUrl, { type: 'module' })` — the URL
 *      is supplied by the host via {@link setKernelWorkerUrl} so this package
 *      stays bundler-agnostic.
 *   4. Posts the {@link WorkerInitMessage} with all transferables on the
 *      transfer list (SAB is not transferred, ports are).
 *   5. Listens for the worker's `{type:'exit', code}` message, marks the
 *      record's `exitCode`, emits `exit` / `close` on the handle, and calls
 *      `worker.terminate()`.
 *
 * The host is expected to call {@link setKernelWorkerUrl} once at boot,
 * passing a URL that resolves to a module containing
 * `import '@rifty/kernel/src/worker-entry.ts';` (typical Vite pattern:
 * `new URL('./workers/kernel-worker-entry.ts', import.meta.url)` with the
 * `?worker&url` import attribute). When the URL is not set, `spawnWorker`
 * throws {@link NotImplementedError} so the failure is loud, not silent.
 */

import { NotImplementedError } from '@rifty/io';
import { type ScriptResolver, registerDefaultHandlers } from './ipc/default-handlers.ts';
import { makeRecursiveRunner } from './ipc/recursive-runner.ts';
import { type SabRing, createSabRing } from './ipc/sab-ring.ts';
import { getExecSyncScriptResolver } from './ipc/script-resolver.ts';
import { SyncRpcDispatcher } from './ipc/sync-dispatch.ts';
import type {
  WorkerEntryDescriptor,
  WorkerInitMessage,
  WorkerSpawnSpec,
  WorkerStdioPorts,
} from './worker-entry.ts';

/**
 * Caller-supplied subset of {@link WorkerSpawnSpec}. The kernel fills in
 * `pid`, `ppid`, `stdio`, and `syncRing` itself so callers cannot accidentally
 * reuse a PID or share a SAB across processes.
 */
export interface SpawnWorkerSpec {
  readonly entry: WorkerEntryDescriptor;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
}

let kernelWorkerUrl: string | URL | null = null;

/**
 * Host-side setter: tell the kernel where to find the kernel-worker entry
 * module. Call once at boot. Idempotent — setting the same URL twice is a
 * no-op; setting a different URL replaces the previous one (the next
 * `spawnWorker` picks it up).
 */
export function setKernelWorkerUrl(url: string | URL): void {
  kernelWorkerUrl = url;
}

/**
 * Returns the URL previously configured via {@link setKernelWorkerUrl}, or
 * `null` if the host hasn't wired it yet. Higher layers (e.g.
 * `child_process.spawn`) use this to choose between the real Worker path
 * and the same-realm fallback per ADR-0011.
 */
export function getKernelWorkerUrl(): string | URL | null {
  return kernelWorkerUrl;
}

/** Test-only: forget the configured URL. Not exported from the package. */
export function clearKernelWorkerUrl(): void {
  kernelWorkerUrl = null;
}

/** Bundle of identity the worker-spawn flow needs from the manager. */
export interface SpawnWorkerIdentity {
  /** PID the kernel has already allocated for this process. */
  pid: number;
  /** Parent PID for the spawning context. Defaults to 1 (main worker). */
  ppid: number;
}

/** Outcome of the spawn: handle is the host-facing object; cleanup runs on
 * `kill` and on the worker's natural exit. */
export interface SpawnWorkerResult {
  readonly pid: number;
  readonly ppid: number;
  readonly worker: Worker;
  readonly ports: WorkerStdioPorts;
  readonly spec: WorkerSpawnSpec;
  /**
   * Parent-side dispatcher attached to the child's SAB ring. Pre-populated
   * with the kernel's default sync syscall handlers (currently
   * `'execSync'`); higher layers may register additional methods via
   * `result.dispatcher.register(...)`.
   */
  readonly dispatcher: SyncRpcDispatcher;
  /** The SAB ring the dispatcher is attached to (parent-side view). */
  readonly ring: SabRing;
  /**
   * Subscribe to the worker's exit message. Returns an `unsubscribe`. The
   * caller drives `ProcessHandle.emit('exit', ...)` etc. — this module
   * deliberately stays pure of the handle plumbing so `process-manager.ts`
   * keeps a single source of truth for that.
   */
  onExit(cb: (code: number) => void): () => void;
  /** Forcibly terminate the worker. Idempotent. */
  terminate(): void;
}

/**
 * Performs the actual `new Worker(...)` + `postMessage(init, transfer)` dance.
 * Throws {@link NotImplementedError} when {@link setKernelWorkerUrl} hasn't
 * been called — this makes the missing host-wiring loud at the call site
 * (no silent fall-through to a broken state).
 */
export function spawnKernelWorker(
  spec: SpawnWorkerSpec,
  identity: SpawnWorkerIdentity,
): SpawnWorkerResult {
  const url = kernelWorkerUrl;
  if (url === null) {
    throw new NotImplementedError(
      'kernel.spawnWorker',
      'kernelWorkerUrl not configured — call setKernelWorkerUrl() at host boot',
    );
  }

  const { pid, ppid } = identity;

  // SAB ring (sync IPC, ADR-0011 phase 1). The Int32 header is shared, so
  // SAB itself is NOT in the transfer list — both peers map it.
  const { sab, ring } = createSabRing();

  // Three MessageChannels for stdio. We give the kernel-side the `port1`s
  // and ship `port2`s to the worker.
  const stdoutCh = new MessageChannel();
  const stderrCh = new MessageChannel();
  const stdinCh = new MessageChannel();

  const ports: WorkerStdioPorts = {
    stdout: stdoutCh.port1,
    stderr: stderrCh.port1,
    stdin: stdinCh.port1,
  };

  const childPorts: WorkerStdioPorts = {
    stdout: stdoutCh.port2,
    stderr: stderrCh.port2,
    stdin: stdinCh.port2,
  };

  const fullSpec: WorkerSpawnSpec = {
    entry: spec.entry,
    argv: spec.argv,
    env: spec.env,
    cwd: spec.cwd,
    stdio: childPorts,
    syncRing: sab,
    pid,
    ppid,
  };

  const worker = new Worker(url, { type: 'module' });

  // ADR-0011 phase 3: stand up the parent-side sync RPC dispatcher and
  // register the kernel's default handlers (currently just `execSync`).
  // Higher layers can attach more handlers via `result.dispatcher.register`.
  const dispatcher = new SyncRpcDispatcher();
  const runner = makeRecursiveRunner(spawnKernelWorker);
  const resolver: ScriptResolver = (path) => {
    const r = getExecSyncScriptResolver();
    return r === null ? null : r(path);
  };
  registerDefaultHandlers(dispatcher, {
    callerPid: pid,
    resolveScript: resolver,
    runWorker: runner,
  });
  dispatcher.attach(ring);

  const init: WorkerInitMessage = { type: 'init', spec: fullSpec };
  worker.postMessage(init, [childPorts.stdout, childPorts.stderr, childPorts.stdin]);

  let terminated = false;
  const exitListeners: ((code: number) => void)[] = [];

  const dispatchExit = (code: number): void => {
    // Snapshot listeners so a handler that unsubscribes itself doesn't
    // skip a peer.
    for (const cb of [...exitListeners]) cb(code);
  };

  worker.addEventListener('message', (ev: MessageEvent) => {
    const msg = ev.data as { type?: string; code?: number } | undefined;
    if (msg?.type === 'exit' && typeof msg.code === 'number') {
      const code = msg.code;
      // The worker's bootstrap calls `self.close()` after posting exit, so
      // `terminate()` is mostly a safety net. Idempotent either way.
      if (!terminated) {
        terminated = true;
        dispatcher.detach(ring);
        try {
          worker.terminate();
        } catch {
          /* the realm may already be gone */
        }
      }
      dispatchExit(code);
    }
  });

  worker.addEventListener('error', (ev: ErrorEvent) => {
    // Convert uncaught worker errors into a code-1 exit. The worker-entry
    // already maps top-level throws to exit-1; this is the safety net for
    // truly catastrophic errors (e.g. module parse failure).
    if (terminated) return;
    terminated = true;
    dispatcher.detach(ring);
    try {
      worker.terminate();
    } catch {
      /* already gone */
    }
    // Surface the error to anyone subscribed via the exit cb — keep the
    // shape simple (code 1) so child_process consumers don't special-case.
    void ev;
    dispatchExit(1);
  });

  return {
    pid,
    ppid,
    worker,
    ports,
    spec: fullSpec,
    dispatcher,
    ring,
    onExit(cb) {
      exitListeners.push(cb);
      return () => {
        const idx = exitListeners.indexOf(cb);
        if (idx !== -1) exitListeners.splice(idx, 1);
      };
    },
    terminate() {
      if (terminated) return;
      terminated = true;
      dispatcher.detach(ring);
      try {
        worker.terminate();
      } catch {
        /* already gone */
      }
    },
  };
}

// Re-export the ring type so consumers (e.g. tests) can type-annotate
// `result.ring` without reaching into the ipc subfolder.
export type { SabRing };
