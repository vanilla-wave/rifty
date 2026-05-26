/**
 * Minimal process manager: per-PID table, parent/child links, dispatch.
 *
 * `spawn` allocates a PID and runs a JS handler with an `IO` object
 * (stdout/stderr/stdin/send/once); `spawnWorker` spawns into its own Web
 * Worker realm (ADR-0011). `kill(pid, signal)` emits `exit`/`close`.
 *
 * Per-PID records are removed from the manager's `table` after the `exit`
 * event has fired, and the internal stdio/IPC emitters are stripped of
 * listeners — so a long-lived host (the playground) doesn't accumulate
 * deceased records or per-spawn listener stacks. The handle object
 * itself survives so callers can still inspect `handle.exitCode`.
 *
 * The runtime-js `child_process` builtin wires Node's API surface to this
 * manager; tests exercise the manager directly.
 */

import { EventEmitter } from './internal/event-emitter.ts';
import { type SpawnWorkerSpec, spawnKernelWorker } from './spawn-worker.ts';
import type { WorkerStdioPorts } from './worker-entry.ts';

export interface ProcessIO {
  write(stream: 'stdout' | 'stderr', chunk: string): void;
  /** Send a structured IPC message (used by fork). */
  send(message: unknown): void;
  /** Listen for incoming IPC messages. */
  onMessage(handler: (msg: unknown) => void): () => void;
  /** Resolve when the parent calls `kill` or the handler returns. */
  signal: AbortSignal;
}

/**
 * Discriminator tagging which spawn path produced the handle. Callers MUST
 * branch on this field rather than reaching for `handle.ports`:
 *
 *   - `'same-realm'` — produced by `ProcessManager.spawn(...)`. Runs the
 *     supplied handler in the parent realm; `ports` is always `undefined`.
 *   - `'worker'` — produced by `ProcessManager.spawnWorker(...)`. Backed by
 *     a real `kernel.spawnWorker` Worker realm (ADR-0011 phase 2); `ports`
 *     carries the parent-side stdio `MessagePort`s.
 */
export type ProcessHandleKind = 'same-realm' | 'worker';

/**
 * Fields common to both spawn branches. `send` is intentionally NOT here —
 * fork-mode IPC is a {@link SameRealmProcessHandle}-only contract today
 * (ADR-0011 phase 2 — Worker-backed IPC is still pending). Putting `send` on
 * a sealed base used to force {@link WorkerProcessHandle} to ship a throwing
 * stub; callers now branch on `handle.kind` and the type system reflects
 * what each branch actually supports.
 */
interface ProcessHandleBase extends EventEmitter {
  readonly pid: number;
  readonly ppid: number;
  readonly command: string;
  /** Per-ADR-0019: cwd is process-scoped state owned by the record. */
  readonly cwd: string;
  /** Mutate the record's cwd. The caller is responsible for validating the path. */
  setCwd(next: string): void;
  exitCode: number | null;
  signalCode: string | null;
  kill(signal?: string): boolean;
}

/**
 * Same-realm `spawn(...)` handle — `ports` is `undefined` by construction.
 * Carries `send()` for fork-mode IPC; callers MUST narrow on
 * `handle.kind === 'same-realm'` before reaching for it.
 */
export interface SameRealmProcessHandle extends ProcessHandleBase {
  readonly kind: 'same-realm';
  readonly ports?: undefined;
  /** Send a message into the child (for `fork`-style IPC). */
  send(message: unknown): boolean;
}

/**
 * Worker-backed `spawnWorker(...)` handle — `ports` is always present.
 * Does NOT carry `send`: fork-mode IPC for Worker-backed children is pending
 * ADR-0011 phase 2 follow-up. When that lands, `send` joins this interface
 * (additive change, no migration of callers needed).
 */
export interface WorkerProcessHandle extends ProcessHandleBase {
  readonly kind: 'worker';
  readonly ports: WorkerStdioPorts;
}

/**
 * Public handle. Sealed discriminated union of {@link SameRealmProcessHandle}
 * and {@link WorkerProcessHandle}. Branch on `handle.kind` for type narrowing.
 */
export type ProcessHandle = SameRealmProcessHandle | WorkerProcessHandle;

interface ProcessRecord {
  readonly pid: number;
  readonly ppid: number;
  readonly command: string;
  /** Per-ADR-0019: cwd is owned here; children inherit a snapshot. */
  cwd: string;
  exitCode: number | null;
  signalCode: string | null;
  /** Outgoing message bus: parent → child. */
  readonly parentToChild: EventEmitter;
  /** Handle for the parent side. Late-bound in {@link ProcessManager.spawn}. */
  handle: ProcessHandle;
  readonly abortController: AbortController;
}

export interface SpawnOptions {
  /** Working directory for the child. Defaults to the parent's cwd. */
  cwd?: string;
}

/** Root cwd for processes that have no parent. */
export const DEFAULT_CWD = '/workspace';

export class ProcessManager {
  private nextPid = 2; // PID 1 is reserved for the main worker.
  private readonly table: Map<number, ProcessRecord> = new Map();

  spawn(
    command: string,
    handler: (io: ProcessIO) => unknown | Promise<unknown>,
    ppid = 1,
    options: SpawnOptions = {},
  ): ProcessHandle {
    const pid = this.nextPid++;
    const parentToChild = new EventEmitter();
    const childToParent = new EventEmitter();
    const abortController = new AbortController();

    // Inherit parent's cwd snapshot (ADR-0019). A `ppid` that names an
    // already-exited process falls through to `DEFAULT_CWD` because the
    // sweep on exit removes the record from `table`.
    const parentRecord = this.table.get(ppid);
    const initialCwd = options.cwd ?? parentRecord?.cwd ?? DEFAULT_CWD;

    const record: ProcessRecord = {
      pid,
      ppid,
      command,
      cwd: initialCwd,
      exitCode: null,
      signalCode: null,
      parentToChild,
      handle: undefined as unknown as ProcessHandle,
      abortController,
    };

    class Handle extends EventEmitter implements SameRealmProcessHandle {
      readonly kind = 'same-realm' as const;
      readonly pid = pid;
      readonly ppid = ppid;
      readonly command = command;
      exitCode: number | null = null;
      signalCode: string | null = null;
      readonly ports = undefined;

      get cwd(): string {
        return record.cwd;
      }
      setCwd(next: string): void {
        record.cwd = next;
      }
      send(message: unknown): boolean {
        parentToChild.emit('message', message);
        return true;
      }
      kill(signal = 'SIGTERM'): boolean {
        if (this.exitCode !== null) return false;
        abortController.abort();
        this.signalCode = signal;
        this.exitCode = null;
        this.emit('exit', null, signal);
        this.emit('close', null, signal);
        manager.finalize(pid, this, [parentToChild, childToParent]);
        return true;
      }
    }

    const handle = new Handle();
    childToParent.on('message', (msg) => handle.emit('message', msg));
    childToParent.on('stdout', (chunk) => handle.emit('stdout', chunk));
    childToParent.on('stderr', (chunk) => handle.emit('stderr', chunk));

    record.handle = handle;
    this.table.set(pid, record);

    const io: ProcessIO = {
      write(stream, chunk) {
        childToParent.emit(stream, chunk);
      },
      send(message) {
        childToParent.emit('message', message);
      },
      onMessage(h) {
        parentToChild.on('message', h);
        return () => parentToChild.off('message', h);
      },
      signal: abortController.signal,
    };

    // Captured by `Handle.kill` and the exit microtask for table sweeping.
    const manager = this;

    queueMicrotask(async () => {
      let exitCode = 0;
      try {
        await handler(io);
      } catch (err) {
        exitCode = 1;
        childToParent.emit(
          'stderr',
          err instanceof Error ? `${err.stack ?? err.message}\n` : String(err),
        );
      }
      if (record.handle.exitCode !== null) return;
      record.handle.exitCode = exitCode;
      record.handle.emit('exit', exitCode, null);
      record.handle.emit('close', exitCode, null);
      manager.finalize(pid, record.handle, [parentToChild, childToParent]);
    });

    return handle;
  }

  /**
   * Drop the per-PID record and clear listeners on `emitters` + `handle`.
   * Called from both spawn paths (kill + natural exit). The handle object
   * survives so callers can read `exitCode`. Idempotent.
   */
  private finalize(pid: number, handle: ProcessHandle, emitters: EventEmitter[]): void {
    if (!this.table.has(pid)) return;
    this.table.delete(pid);
    for (const e of emitters) e.removeAllListeners();
    handle.removeAllListeners();
  }

  /** Spawn into its own Worker realm (ADR-0011). See `spawnKernelWorker`. */
  spawnWorker(
    command: string,
    spec: SpawnWorkerSpec,
    ppid = 1,
    options: SpawnOptions = {},
  ): ProcessHandle {
    const parentRecord = this.table.get(ppid);
    const initialCwd = options.cwd ?? spec.cwd ?? parentRecord?.cwd ?? DEFAULT_CWD;

    // Allocate PID from the same counter `spawn` uses so the PID space
    // stays unified across same-realm and Worker-backed children.
    const pid = this.nextPid++;

    const spawnResult = spawnKernelWorker({ ...spec, cwd: initialCwd }, { pid, ppid });

    const abortController = new AbortController();
    const ports = spawnResult.ports;

    const record: ProcessRecord = {
      pid,
      ppid,
      command,
      cwd: initialCwd,
      exitCode: null,
      signalCode: null,
      parentToChild: new EventEmitter(),
      handle: undefined as unknown as ProcessHandle,
      abortController,
    };

    // Captured by `WorkerHandle.kill` and the exit callback for sweeping.
    const manager = this;

    class WorkerHandle extends EventEmitter implements WorkerProcessHandle {
      readonly kind = 'worker' as const;
      readonly pid = pid;
      readonly ppid = ppid;
      readonly command = command;
      exitCode: number | null = null;
      signalCode: string | null = null;
      readonly ports = ports;

      get cwd(): string {
        return record.cwd;
      }
      setCwd(next: string): void {
        record.cwd = next;
      }
      kill(signal = 'SIGTERM'): boolean {
        if (this.exitCode !== null) return false;
        abortController.abort();
        spawnResult.terminate();
        this.signalCode = signal;
        this.exitCode = null;
        this.emit('exit', null, signal);
        this.emit('close', null, signal);
        manager.finalize(pid, this, [record.parentToChild]);
        return true;
      }
    }

    const handle = new WorkerHandle();
    record.handle = handle;
    this.table.set(pid, record);

    spawnResult.onExit((code) => {
      if (handle.exitCode !== null || handle.signalCode !== null) return;
      handle.exitCode = code;
      handle.emit('exit', code, null);
      handle.emit('close', code, null);
      manager.finalize(pid, handle, [record.parentToChild]);
    });

    // Surface `messageerror` events on the handle so callers don't have
    // to reach into `SpawnWorkerResult` (review §1.10).
    spawnResult.onMessageError((ev) => {
      handle.emit('messageerror', ev);
    });

    return handle;
  }

  get(pid: number): ProcessHandle | null {
    return this.table.get(pid)?.handle ?? null;
  }

  list(): ProcessHandle[] {
    return [...this.table.values()].map((r) => r.handle);
  }
}

export const globalProcessManager = new ProcessManager();
