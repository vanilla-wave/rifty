/**
 * Minimal process manager: per-PID table, parent/child links, dispatch.
 *
 * Spawn semantics for M6:
 *   - `spawn(handler, options)` allocates a PID, calls the handler with an
 *     `IO` object exposing stdout/stderr/stdin/send/once, and tracks exit.
 *   - Handlers are JS functions (we don't actually spawn OS processes — Workers
 *     are the real isolation in the browser; this layer abstracts that).
 *   - `kill(pid, signal)` emits an `exit` event with the signal.
 *
 * The runtime-js `child_process` builtin wires Node's API surface to this
 * manager; tests exercise the manager directly.
 */

import { NotImplementedError } from '@rifty/io';
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

export interface ProcessHandle extends EventEmitter {
  readonly pid: number;
  readonly ppid: number;
  readonly command: string;
  /** Per-ADR-0019: cwd is process-scoped state owned by the record. */
  readonly cwd: string;
  /** Mutate the record's cwd. The caller is responsible for validating the path. */
  setCwd(next: string): void;
  exitCode: number | null;
  signalCode: string | null;
  /** Send a message into the child (for `fork`-style IPC). */
  send(message: unknown): boolean;
  kill(signal?: string): boolean;
  /**
   * For Worker-backed children (ADR-0011 phase 2): the parent-side stdio
   * `MessagePort`s. Undefined for same-realm fallback children — callers
   * should branch on `handle.ports !== undefined` rather than assume.
   */
  readonly ports?: WorkerStdioPorts;
}

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

    // Inherit parent's cwd snapshot. Subsequent chdir in parent does not
    // propagate to the child (and vice versa) — see ADR-0019.
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

    class Handle extends EventEmitter implements ProcessHandle {
      readonly pid = pid;
      readonly ppid = ppid;
      readonly command = command;
      exitCode: number | null = null;
      signalCode: string | null = null;

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
    });

    return handle;
  }

  /**
   * Spawn a child in its own Web Worker realm (ADR-0011 phase 2). The kernel
   * allocates the PID, creates a {@link SabRing}, three stdio
   * `MessageChannel`s, posts the init message, and tracks exit via the
   * worker's `{type:'exit', code}` message.
   *
   * Throws if {@link setKernelWorkerUrl} hasn't been called by the host.
   * Same-realm callers stay on {@link spawn} until they're ready to migrate
   * (or stay forever for in-realm-only use cases).
   */
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

    class WorkerHandle extends EventEmitter implements ProcessHandle {
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
      send(_message: unknown): boolean {
        // ADR-0011 phase 2 follow-up (TASKS.md M6 "Open acceptance" +
        // review item §1.10): IPC-over-MessagePort for Worker-backed
        // children is not implemented yet. The previous `return false`
        // was a silent stub (violates CLAUDE.md "no silent stubs") — the
        // ChildProcess wrapper in runtime-js does not call into this
        // path today (it emits on its own `inboundIpc` bus), but a
        // future caller that did would silently lose every message.
        // Throw loudly until the real IPC channel lands.
        throw new NotImplementedError(
          'kernel.WorkerHandle.send',
          'ChildProcess.stdin/fork IPC pending M6 phase 2 — see ADR-0011',
        );
      }
      kill(signal = 'SIGTERM'): boolean {
        if (this.exitCode !== null) return false;
        abortController.abort();
        spawnResult.terminate();
        this.signalCode = signal;
        this.exitCode = null;
        this.emit('exit', null, signal);
        this.emit('close', null, signal);
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
    });

    // Review fix §1.10 — surface worker `messageerror` events on the
    // public handle so callers can attach a listener without reaching
    // into the kernel-internal `SpawnWorkerResult`. The spawn-worker
    // module also `console.warn`s as a fallback.
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
