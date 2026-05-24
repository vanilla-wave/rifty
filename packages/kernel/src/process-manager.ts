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

import { EventEmitter } from './internal/event-emitter.ts';

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

  get(pid: number): ProcessHandle | null {
    return this.table.get(pid)?.handle ?? null;
  }

  list(): ProcessHandle[] {
    return [...this.table.values()].map((r) => r.handle);
  }
}

export const globalProcessManager = new ProcessManager();
