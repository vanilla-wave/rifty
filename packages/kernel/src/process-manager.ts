/**
 * Minimal process manager: per-PID table, parent/child links, dispatch.
 *
 * `spawn` allocates a PID and runs a JS handler with an `IO` object;
 * `spawnWorker` spawns into its own Web Worker realm (ADR-0011).
 * `kill(pid, signal)` emits `exit`/`close`.
 *
 * Per-PID records are swept from `table` after `exit` fires, and the internal
 * stdio/IPC emitters are stripped of listeners, so a long-lived host (the
 * playground) doesn't accumulate deceased records or per-spawn listener stacks.
 * The handle object survives so callers can still read `handle.exitCode`.
 *
 * The runtime-js `child_process` builtin wires Node's API surface to this
 * manager; tests exercise the manager directly.
 */

import { Readable, Writable } from '@riftydev/io';
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
 * Wire frame for the fork-mode IPC channel between
 * {@link WorkerProcessHandle} and the worker-side `process` shim
 * (ADR-0045). Both directions share the vocabulary so either peer can post
 * either kind. No version field — parent and child are built together.
 */
export type IpcFrame =
  | { readonly kind: 'ipc:message'; readonly payload: unknown }
  | { readonly kind: 'ipc:disconnect' };

/**
 * Fields common to both spawn branches. Each variant carries its own `send`
 * signature: same-realm routes through an in-realm `EventEmitter`,
 * Worker-backed through a `MessagePort` pair (ADR-0045). Callers narrow on
 * `handle.kind` first.
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
 * Carries fork-mode IPC (ADR-0045) over the dedicated parent↔child
 * `MessagePort` pair: {@link send} posts a frame to the worker, the worker's
 * reciprocal `process.send` surfaces as a `'message'` event here, and
 * {@link disconnect} closes the channel.
 *
 * Stdio accessors (`stdout` / `stderr` / `stdin`) wrap the underlying
 * `MessagePort` triple as `@riftydev/io` streams — the supported surface for
 * parent-side stdio. The raw `ports` field is kept for tooling that needs the
 * `MessagePort` objects directly; prefer the accessors.
 */
export interface WorkerProcessHandle extends ProcessHandleBase {
  readonly kind: 'worker';
  /**
   * @deprecated Prefer `stdout()` / `stderr()` / `stdin()`. The raw triple
   * is kept for an interim release to unblock M11's `WasiProcessHandle`
   * dispatch experiments; remove when no consumer reaches for it directly.
   */
  readonly ports: WorkerStdioPorts;
  /**
   * Read-side of the worker's stdout. Pushes `Uint8Array` chunks as the
   * worker writes; emits `'end'` after `push(null)` on worker exit. Same
   * instance is returned on repeated calls (singleton per handle).
   */
  stdout(): Readable;
  /** Read-side of the worker's stderr. Same shape as {@link stdout}. */
  stderr(): Readable;
  /**
   * Write-side of the worker's stdin. `write(chunk)` posts `chunk` to the
   * worker's stdin port; `end()` closes the port. Same instance is returned
   * on repeated calls.
   */
  stdin(): Writable;
  /**
   * Send an IPC message to the worker child (ADR-0045). Returns `false`
   * after `disconnect()` or worker exit (matches Node's `subprocess.send`
   * behaviour); `true` when the message is posted. Structured-clone
   * failures surface asynchronously as `'messageerror'` on the handle —
   * they do NOT downgrade the return value to `false`.
   */
  send(message: unknown): boolean;
  /**
   * Close the IPC channel (ADR-0045). Idempotent. Posts an `ipc:disconnect`
   * frame to the worker, closes the parent-side IPC port, and emits
   * `'disconnect'` on this handle. Subsequent `send` calls return `false`.
   * Called automatically on worker exit (natural or terminate).
   */
  disconnect(): void;
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

      #stdoutReadable: Readable | null = null;
      #stderrReadable: Readable | null = null;
      #stdinWritable: Writable | null = null;

      // ADR-0045: parent-side IPC port lifecycle. `#ipcStarted` flips on the
      // first `onmessage` wiring; `#ipcDisconnected` blocks `send` /
      // `disconnect` from posting after teardown.
      #ipcStarted = false;
      #ipcDisconnected = false;

      get cwd(): string {
        return record.cwd;
      }
      setCwd(next: string): void {
        record.cwd = next;
      }
      stdout(): Readable {
        if (!this.#stdoutReadable) this.#stdoutReadable = bindPortAsReadable(ports.stdout);
        return this.#stdoutReadable;
      }
      stderr(): Readable {
        if (!this.#stderrReadable) this.#stderrReadable = bindPortAsReadable(ports.stderr);
        return this.#stderrReadable;
      }
      stdin(): Writable {
        if (!this.#stdinWritable) this.#stdinWritable = bindPortAsWritable(ports.stdin);
        return this.#stdinWritable;
      }
      /**
       * Internal: start the parent-side IPC port and bind the `onmessage`
       * dispatcher to surface `'message'` and `'disconnect'` events. Called
       * once at construction time; idempotent.
       */
      _startIpc(): void {
        if (this.#ipcStarted) return;
        this.#ipcStarted = true;
        ports.ipc.onmessage = (ev: MessageEvent) => {
          const frame = ev.data as IpcFrame | undefined;
          if (!frame || typeof frame !== 'object' || typeof frame.kind !== 'string') return;
          if (frame.kind === 'ipc:message') {
            this.emit('message', frame.payload);
          } else if (frame.kind === 'ipc:disconnect') {
            this._tearDownIpc();
          }
        };
        ports.ipc.start();
      }
      /**
       * Internal: tear down the parent-side IPC port. Idempotent — second
       * call is a no-op. Closes the port, emits `'disconnect'` exactly once.
       */
      _tearDownIpc(): void {
        if (this.#ipcDisconnected) return;
        this.#ipcDisconnected = true;
        try {
          ports.ipc.close();
        } catch {
          /* peer may have closed already */
        }
        this.emit('disconnect');
      }
      /** Internal: push EOF on the read-side streams; called once on exit. */
      _signalEof(): void {
        if (this.#stdoutReadable) this.#stdoutReadable.push(null);
        if (this.#stderrReadable) this.#stderrReadable.push(null);
        if (this.#stdinWritable && !this.#stdinWritable._writableState.ending) {
          this.#stdinWritable.end();
        }
      }
      send(message: unknown): boolean {
        // Node's `subprocess.send` returns `false` once the channel is closed.
        // Structured-clone failures bubble out as 'messageerror' on the worker
        // side, not via this return value.
        if (this.#ipcDisconnected || this.exitCode !== null || this.signalCode !== null) {
          return false;
        }
        try {
          const frame: IpcFrame = { kind: 'ipc:message', payload: message };
          ports.ipc.postMessage(frame);
          return true;
        } catch {
          // postMessage throws synchronously if the port was disentangled
          // (peer closed it). Treat as disconnect, return a stable `false`.
          this._tearDownIpc();
          return false;
        }
      }
      disconnect(): void {
        if (this.#ipcDisconnected) return;
        try {
          const frame: IpcFrame = { kind: 'ipc:disconnect' };
          ports.ipc.postMessage(frame);
        } catch {
          /* peer may have closed already */
        }
        this._tearDownIpc();
      }
      kill(signal = 'SIGTERM'): boolean {
        if (this.exitCode !== null) return false;
        abortController.abort();
        spawnResult.terminate();
        this.signalCode = signal;
        this.exitCode = null;
        this._signalEof();
        this._tearDownIpc();
        this.emit('exit', null, signal);
        this.emit('close', null, signal);
        manager.finalize(pid, this, [record.parentToChild]);
        return true;
      }
    }

    const handle = new WorkerHandle();
    record.handle = handle;
    this.table.set(pid, record);

    // Start the IPC port AFTER `record.handle` is wired, so any synchronous
    // `'message'` / `'disconnect'` dispatch sees a fully-constructed
    // handle. The IPC port is otherwise inert (no auto-start).
    handle._startIpc();

    spawnResult.onExit((code) => {
      if (handle.exitCode !== null || handle.signalCode !== null) return;
      handle.exitCode = code;
      handle._signalEof();
      handle._tearDownIpc();
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

/**
 * Wrap the raw `MessagePort` triple as `@riftydev/io` streams: push-side
 * `Readable` and post-side `Writable`. Kept here as they're only meaningful
 * for a `WorkerProcessHandle`.
 */
function bindPortAsReadable(port: MessagePort): Readable {
  const r = new Readable({ read() {} });
  port.onmessage = (ev: MessageEvent) => {
    const data = ev.data;
    if (data instanceof Uint8Array) r.push(data);
  };
  // Browsers don't auto-start the port when only `onmessage` is set
  // (vs `addEventListener('message', …)`); kick it.
  port.start();
  return r;
}

function bindPortAsWritable(port: MessagePort): Writable {
  return new Writable({
    write(chunk, _encoding, cb) {
      try {
        if (chunk instanceof Uint8Array) {
          port.postMessage(chunk);
        } else if (typeof chunk === 'string') {
          port.postMessage(new TextEncoder().encode(chunk));
        } else {
          // Object-mode payloads pass through verbatim.
          port.postMessage(chunk);
        }
        cb();
      } catch (err) {
        cb(err instanceof Error ? err : new Error(String(err)));
      }
    },
    final(cb) {
      try {
        port.close();
        cb();
      } catch (err) {
        cb(err instanceof Error ? err : new Error(String(err)));
      }
    },
  });
}
