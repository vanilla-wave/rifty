/**
 * Kernel-side `spawnWorker` (ADR-0011 phase 2 + phase 3).
 *
 * Builds the SAB ring + stdio MessageChannels, constructs the Worker via
 * {@link makeKernelWorker} (test-stubbable), posts the init message, and
 * surfaces the worker's `exit` / `error` / `messageerror` events on the
 * returned {@link SpawnWorkerResult}. Throws if {@link setKernelWorkerUrl}
 * hasn't been called by the host.
 *
 * All spawns share the singleton {@link SyncRpcDispatcher}. On exit/terminate
 * the `removeEventListener`s mirror the `addEventListener`s, so the
 * `WorkerLike` is GC-eligible.
 */

import { NotImplementedError } from '@riftydev/io';
import { getKernelDispatcher } from './ipc/kernel-dispatcher.ts';
import { DEFAULT_PAYLOAD_CAPACITY, type SabRing, createSabRing } from './ipc/sab-ring.ts';
import type { SyncRpcDispatcher } from './ipc/sync-dispatch.ts';
import type {
  WorkerEntryDescriptor,
  WorkerInitMessage,
  WorkerSpawnSpec,
  WorkerStdioPorts,
} from './worker-entry.ts';
import { type WorkerLike, makeKernelWorker } from './worker-like.ts';

// Re-export so existing tests keep their single-import deep path.
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
  /**
   * Optional per-direction SAB ring payload capacity (ADR-0084 #19). Both the
   * allocated `syncRing` and the child-side attach derive from this single
   * value, so the two peers can never disagree. Defaults to
   * {@link DEFAULT_PAYLOAD_CAPACITY}. Not lowered this wave (see ADR-0084).
   */
  readonly payloadCapacity?: number;
  /**
   * Server-process flag (ADR-0144). When `true`, the kernel does NOT reap this
   * worker when its entry finishes setup cleanly — it stays alive until the
   * handle is killed. Use for long-lived owners (the ADR-0143 workspace owner,
   * the real-vite preview owner). Defaults to run-to-completion.
   */
  readonly serve?: boolean;
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
  /** Singleton parent-side dispatcher. Empty by default (ADR-0039) — higher
   * layers register methods via `.register(...)` at boot. */
  readonly dispatcher: SyncRpcDispatcher;
  /** The SAB ring the dispatcher is attached to (parent-side view). */
  readonly ring: SabRing;
  /** Subscribe to the worker's exit message. Returns an `unsubscribe`. */
  onExit(cb: (code: number) => void): () => void;
  /** Subscribe to `messageerror` (structured-clone failures during
   * `postMessage`). Listeners receive the raw event; the worker is NOT
   * terminated (matches browser semantics). Review fix §1.10. */
  onMessageError(cb: (ev: MessageEvent) => void): () => void;
  /**
   * Subscribe to a worker's uncaught GLOBAL error message — an error that
   * ESCAPED worker-entry's top-level try/catch (thrown in a queueMicrotask /
   * timer, or an unhandled EventEmitter `'error'` re-throw like EADDRINUSE) and
   * surfaced via the worker's `error` event. Fires once, just before the exit-1
   * dispatch, with a newline-terminated message. The process manager forwards
   * it onto the child's stderr stream so the diagnostic is not lost behind the
   * opaque exit 1 (backlog/kernel/worker-global-error-to-stderr).
   */
  onUncaughtError(cb: (message: string) => void): () => void;
  /** Forcibly terminate the worker. Idempotent. */
  terminate(): void;
}

/**
 * Performs the `new Worker(...)` + `postMessage(init, transfer)` dance.
 * Throws {@link NotImplementedError} when {@link setKernelWorkerUrl} hasn't
 * been called — makes missing host-wiring loud at the call site rather than
 * silently falling through to a broken state.
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

  // SAB ring (sync IPC, ADR-0011 phase 1). SAB is shared, so it is NOT in the
  // transfer list — both peers map it. ADR-0084 #19: a single capacity value
  // sizes the buffer AND travels in the spec so the child attaches identically.
  const payloadCapacity = spec.payloadCapacity ?? DEFAULT_PAYLOAD_CAPACITY;
  const { sab, ring } = createSabRing({ payloadCapacity });

  // Four MessageChannels: three for stdio, one for fork-mode IPC (ADR-0045).
  // Kernel-side keeps the `port1`s; `port2`s ship to the worker.
  const stdoutCh = new MessageChannel();
  const stderrCh = new MessageChannel();
  const stdinCh = new MessageChannel();
  const ipcCh = new MessageChannel();

  const ports: WorkerStdioPorts = {
    stdout: stdoutCh.port1,
    stderr: stderrCh.port1,
    stdin: stdinCh.port1,
    ipc: ipcCh.port1,
  };

  const childPorts: WorkerStdioPorts = {
    stdout: stdoutCh.port2,
    stderr: stderrCh.port2,
    stdin: stdinCh.port2,
    ipc: ipcCh.port2,
  };

  const fullSpec: WorkerSpawnSpec = {
    entry: spec.entry,
    argv: spec.argv,
    env: spec.env,
    cwd: spec.cwd,
    stdio: childPorts,
    syncRing: sab,
    payloadCapacity,
    pid,
    ppid,
    serve: spec.serve,
  };

  const worker: WorkerLike = makeKernelWorker(url);

  // ADR-0011 phase 3: share the single module-level dispatcher across every
  // spawn. `attach(ring)` is idempotent and reuses the global polling timer.
  const dispatcher = getKernelDispatcher();
  dispatcher.attach(ring);

  const init: WorkerInitMessage = { type: 'init', spec: fullSpec };
  try {
    worker.postMessage(init, [
      childPorts.stdout,
      childPorts.stderr,
      childPorts.stdin,
      childPorts.ipc,
    ]);
  } catch (error) {
    // Init is the commit point for this resource transaction. A synchronous
    // structured-clone/transfer failure returns no handle to the caller, so
    // roll back every resource acquired above before preserving the error.
    dispatcher.detach(ring);
    try {
      worker.terminate();
    } catch {
      /* the worker constructor succeeded but its realm may already be gone */
    }
    for (const port of [
      ports.stdout,
      ports.stderr,
      ports.stdin,
      ports.ipc,
      childPorts.stdout,
      childPorts.stderr,
      childPorts.stdin,
      childPorts.ipc,
    ]) {
      try {
        port.close();
      } catch {
        /* a failed transfer may already have disentangled the port */
      }
    }
    throw error;
  }

  let terminated = false;
  const exitListeners: ((code: number) => void)[] = [];
  const messageErrorListeners: ((ev: MessageEvent) => void)[] = [];
  const uncaughtErrorListeners: ((message: string) => void)[] = [];

  const dispatchExit = (code: number): void => {
    // Snapshot so a handler that unsubscribes itself doesn't skip a peer.
    for (const cb of [...exitListeners]) cb(code);
  };

  const dispatchMessageError = (ev: MessageEvent): void => {
    for (const cb of [...messageErrorListeners]) cb(ev);
  };

  const dispatchUncaughtError = (message: string): void => {
    for (const cb of [...uncaughtErrorListeners]) cb(message);
  };

  /**
   * Detach the dispatcher, terminate the worker, and remove every installed
   * listener. Idempotent. Subscriber arrays are cleared by callers AFTER the
   * final dispatch so waiters still receive their event.
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
    uncaughtErrorListeners.length = 0;
  }

  // Named handlers so `tearDownWorker` can `removeEventListener` them;
  // anonymous closures would leak per spawn forever.
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
  // Map uncaught worker errors to a code-1 exit — catches module parse
  // failures AND errors that escaped worker-entry's top-level try/catch (thrown
  // in a queueMicrotask / timer, or an unhandled EventEmitter `'error'`
  // re-throw like EADDRINUSE). worker-entry already wrote a top-level throw's
  // stack to the child stderr before its normal exit, so that path never
  // reaches here; an ESCAPED error left NO stderr text behind, so forward the
  // event's message to the child stderr (mirrors host.ts's `[worker error]`)
  // before the exit-1 dispatch — keeping the diagnostic from vanishing behind
  // the opaque exit 1 (backlog/kernel/worker-global-error-to-stderr).
  const onError = (ev: MessageEvent): void => {
    if (terminated) return;
    const e = ev as unknown as { message?: unknown; filename?: unknown; lineno?: unknown };
    const message =
      typeof e.message === 'string' && e.message.length > 0
        ? e.message
        : 'Worker terminated by an uncaught error';
    const loc =
      typeof e.filename === 'string' && e.filename.length > 0
        ? ` (${e.filename}:${typeof e.lineno === 'number' ? e.lineno : 0})`
        : '';
    tearDownWorker();
    dispatchUncaughtError(`${message}${loc}\n`);
    // Defer the exit one microtask so the forwarded stderr `'data'` (the
    // `@riftydev/io` Readable flushes on a queueMicrotask) is delivered BEFORE
    // the exit fires. A foreground consumer (owner-child-node-executor /
    // bin-executor) mutes output synchronously in its `'exit'` handler, so a
    // same-tick exit would drop the diagnostic. The push above enqueues its
    // flush microtask first, so this one runs after it (FIFO).
    queueMicrotask(() => {
      dispatchExit(1);
      clearSubscribers();
    });
  };

  // `messageerror` fires when the browser fails to structured-clone an
  // incoming message (functions, Symbols, etc.). Non-fatal per browser
  // semantics — log and surface, but do NOT tear down.
  const onMessageError = (ev: MessageEvent): void => {
    // eslint-disable-next-line no-console -- explicit logging contract
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
    onUncaughtError(cb) {
      uncaughtErrorListeners.push(cb);
      return () => {
        const idx = uncaughtErrorListeners.indexOf(cb);
        if (idx !== -1) uncaughtErrorListeners.splice(idx, 1);
      };
    },
    terminate() {
      tearDownWorker();
      clearSubscribers();
    },
  };
}

// ADR-0039: no `setKernelRecursiveSpawn(spawnKernelWorker)` at module load.
// The recursive-spawn handshake belonged to the Node `'execSync'` handler,
// now in `@riftydev/runtime-js`, which imports `spawnKernelWorker` directly
// (top-down).

// Re-export so consumers can type-annotate `result.ring` without reaching
// into the ipc subfolder.
export type { SabRing };
