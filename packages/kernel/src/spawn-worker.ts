/**
 * Kernel-side `spawnWorker` (ADR-0011 phase 2 + phase 3).
 *
 * Builds the SAB ring + stdio MessageChannels, constructs the Worker via
 * {@link makeKernelWorker} (test-stubbable), posts the init message, and
 * surfaces the worker's `exit` / `error` / `messageerror` events on the
 * returned {@link SpawnWorkerResult}. Throws if {@link setKernelWorkerUrl}
 * hasn't been called by the host.
 *
 * All spawns share the singleton {@link SyncRpcDispatcher} (review §2.11
 * fix). On exit/terminate the kernel-side `removeEventListener`s mirror
 * the `addEventListener`s, so the `WorkerLike` is GC-eligible.
 */

import { NotImplementedError } from '@rifty/io';
import { getKernelDispatcher, setKernelRecursiveSpawn } from './ipc/kernel-dispatcher.ts';
import { type SabRing, createSabRing } from './ipc/sab-ring.ts';
import type { SyncRpcDispatcher } from './ipc/sync-dispatch.ts';
import type {
  WorkerEntryDescriptor,
  WorkerInitMessage,
  WorkerSpawnSpec,
  WorkerStdioPorts,
} from './worker-entry.ts';
import { type WorkerLike, makeKernelWorker } from './worker-like.ts';

// Re-export so existing tests (`packages/kernel/tests/*`) keep their
// single-import deep path. Public surface trimming is out of scope.
export { clearKernelDispatcher, getKernelDispatcher } from './ipc/kernel-dispatcher.ts';
export {
  type WorkerLike,
  clearWorkerFactoryForTests,
  setWorkerFactoryForTests,
} from './worker-like.ts';

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

/** Outcome of the spawn. Cleanup runs on `kill` and on natural exit. */
export interface SpawnWorkerResult {
  readonly pid: number;
  readonly ppid: number;
  readonly worker: WorkerLike;
  readonly ports: WorkerStdioPorts;
  readonly spec: WorkerSpawnSpec;
  /** Singleton parent-side dispatcher; default handlers (`'execSync'`)
   * already registered. Higher layers can add methods via `.register(...)`. */
  readonly dispatcher: SyncRpcDispatcher;
  /** The SAB ring the dispatcher is attached to (parent-side view). */
  readonly ring: SabRing;
  /** Subscribe to the worker's exit message. Returns an `unsubscribe`. */
  onExit(cb: (code: number) => void): () => void;
  /** Subscribe to `messageerror` (structured-clone failures during
   * `postMessage`). Listeners receive the raw event; the worker is NOT
   * terminated (matches browser semantics). Review fix §1.10. */
  onMessageError(cb: (ev: MessageEvent) => void): () => void;
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

  const worker: WorkerLike = makeKernelWorker(url);

  // ADR-0011 phase 3 (review fix): share the single module-level
  // dispatcher across every spawn. `attach(ring)` is idempotent and
  // reuses the global polling timer.
  const dispatcher = getKernelDispatcher();
  dispatcher.attach(ring);

  const init: WorkerInitMessage = { type: 'init', spec: fullSpec };
  worker.postMessage(init, [childPorts.stdout, childPorts.stderr, childPorts.stdin]);

  let terminated = false;
  const exitListeners: ((code: number) => void)[] = [];
  const messageErrorListeners: ((ev: MessageEvent) => void)[] = [];

  const dispatchExit = (code: number): void => {
    // Snapshot listeners so a handler that unsubscribes itself doesn't
    // skip a peer.
    for (const cb of [...exitListeners]) cb(code);
  };

  const dispatchMessageError = (ev: MessageEvent): void => {
    for (const cb of [...messageErrorListeners]) cb(ev);
  };

  /**
   * Shared teardown for the worker side: detach the dispatcher, terminate
   * the worker, and `removeEventListener` for every listener the kernel
   * installed. Idempotent. Subscriber arrays are cleared by callers AFTER
   * the final dispatch so waiters still receive their event.
   */
  function tearDownWorker(): void {
    if (terminated) return;
    terminated = true;
    dispatcher.detach(ring);
    try {
      worker.terminate();
    } catch {
      /* the realm may already be gone */
    }
    worker.removeEventListener('message', onMessage);
    worker.removeEventListener('error', onError);
    worker.removeEventListener('messageerror', onMessageError);
  }

  function clearSubscribers(): void {
    exitListeners.length = 0;
    messageErrorListeners.length = 0;
  }

  // Named handlers so `tearDownWorker`'s `removeEventListener`s can find
  // them. Anonymous closures here would leak per spawn forever.
  const onMessage = (ev: MessageEvent): void => {
    const msg = ev.data as { type?: string; code?: number } | undefined;
    if (msg?.type === 'exit' && typeof msg.code === 'number') {
      const code = msg.code;
      tearDownWorker();
      dispatchExit(code);
      clearSubscribers();
    }
  };

  // `ErrorEvent` is DOM-only; structurally it arrives as `MessageEvent`.
  // Map uncaught worker errors to a code-1 exit (worker-entry already
  // maps top-level throws to exit-1; this catches module parse failures).
  const onError = (ev: MessageEvent): void => {
    if (terminated) return;
    tearDownWorker();
    void ev;
    dispatchExit(1);
    clearSubscribers();
  };

  // Review fix §1.10 — `messageerror` fires when the browser fails to
  // structured-clone an incoming message (functions, Symbols, etc.).
  // Non-fatal (matches browser semantics) — we log and surface, but do
  // NOT tear down.
  const onMessageError = (ev: MessageEvent): void => {
    // eslint-disable-next-line no-console -- explicit logging contract per review fix
    console.warn(
      `[kernel.spawnKernelWorker] worker (pid=${pid}) reported messageerror; a posted message could not be deserialised`,
    );
    dispatchMessageError(ev);
  };

  worker.addEventListener('message', onMessage);
  worker.addEventListener('error', onError);
  worker.addEventListener('messageerror', onMessageError);

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
    onMessageError(cb) {
      messageErrorListeners.push(cb);
      return () => {
        const idx = messageErrorListeners.indexOf(cb);
        if (idx !== -1) messageErrorListeners.splice(idx, 1);
      };
    },
    terminate() {
      tearDownWorker();
      clearSubscribers();
    },
  };
}

// Wire the recursive-spawn reference into the dispatcher singleton at
// module load. This is the one-shot handshake that avoids a static
// cycle (`ipc/kernel-dispatcher.ts` → `spawn-worker.ts` → ...). It must
// run after `spawnKernelWorker` is declared so the function value is
// captured, not hoisted as `undefined`.
setKernelRecursiveSpawn(spawnKernelWorker);

// Re-export the ring type so consumers (e.g. tests) can type-annotate
// `result.ring` without reaching into the ipc subfolder.
export type { SabRing };
