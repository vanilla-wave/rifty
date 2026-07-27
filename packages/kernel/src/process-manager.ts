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
import { getKernelDispatcher } from './ipc/kernel-dispatcher.ts';
import type { SyncRpcCallerContext } from './ipc/sync-dispatch.ts';
import { readKernelProcessSpec, readKernelSyncApi } from './shared-globals.ts';
import { type SpawnWorkerSpec, spawnKernelWorker } from './spawn-worker.ts';
import type { WorkerStdioPorts } from './worker-entry.ts';
import {
  abandonWorkerOutput,
  cutWorkerOutput,
  isWorkerOutputChildSealed,
} from './worker-stdio-drain.ts';

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
 * Wire frame for the shared user-IPC/process-control channel between
 * {@link WorkerProcessHandle} and the worker-side `process` shim
 * (ADR-0045/0225). No version field — parent and child are built together.
 */
export type IpcFrame =
  | { readonly kind: 'ipc:message'; readonly payload: unknown }
  | { readonly kind: 'ipc:tty-resize'; readonly cols: number; readonly rows: number }
  | { readonly kind: 'ipc:disconnect' }
  | { readonly kind: 'control:signal'; readonly signal: string }
  | { readonly kind: 'control:self-signal'; readonly signal: string }
  | { readonly kind: 'control:self-exit'; readonly code: number }
  | { readonly kind: 'control:peer-closing' }
  | { readonly kind: 'control:kill-tree'; readonly pid: number; readonly signal: string }
  | {
      readonly kind: 'control:listening';
      readonly ports: readonly number[];
      readonly previewScope?: string;
    };

export interface ProcessListeningControl {
  /** Kernel-attested process identity; never accepted from the guest frame. */
  readonly pid: number;
  readonly ports: number[];
  readonly previewScope?: string;
}

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
   * worker's stdin port; `end()` posts explicit EOF, then closes the data port.
   * Same instance is returned on repeated calls.
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
  /** Deliver a live terminal grid update over the physical control plane. */
  resize(cols: number, rows: number): boolean;
  /**
   * Logically disconnect user IPC (ADR-0045). Idempotent. The physical port
   * remains available for process controls such as TTY resize until exit.
   */
  disconnect(): void;
  controlKill(pid: number, signal: string): boolean;
  onListeningControl(listener: (control: ProcessListeningControl) => void): () => void;
}

/**
 * Public handle. Sealed discriminated union of {@link SameRealmProcessHandle}
 * and {@link WorkerProcessHandle}. Branch on `handle.kind` for type narrowing.
 */
export type ProcessHandle = SameRealmProcessHandle | WorkerProcessHandle;

export interface ProcessSnapshot {
  readonly pid: number;
  readonly ppid: number;
  readonly command: string;
}

interface ProcessRecord {
  readonly pid: number;
  readonly ppid: number;
  readonly treeParentPid: number;
  readonly published: boolean;
  readonly upstreamAuthority: boolean;
  readonly physicalRoute?: SyncRpcCallerContext;
  readonly remoteOwnerPid?: number;
  readonly remoteOwnerRoute?: SyncRpcCallerContext;
  remoteListening: boolean;
  readonly command: string;
  /** Per-ADR-0019: cwd is owned here; children inherit a snapshot. */
  cwd: string;
  exitCode: number | null;
  signalCode: string | null;
  /** Outgoing message bus: parent → child. */
  readonly parentToChild: EventEmitter;
  /** Handle for the parent side. Late-bound in {@link ProcessManager.spawn}. */
  handle: ProcessHandle | null;
  readonly abortController: AbortController;
  terminate(signal: string): boolean;
  fail(code: number): boolean;
  peerFail(error: Error): boolean;
}

type WorkerTerminalOutcome =
  | {
      readonly kind: 'exit';
      readonly code: number;
      readonly cause: 'natural' | 'failure';
      readonly error?: Error;
    }
  | { readonly kind: 'signal'; readonly signal: string }
  | { readonly kind: 'peererror'; readonly error: Error };

interface ProcessRouteOwner {
  readonly ownerPid: number;
  readonly ownerRoute?: SyncRpcCallerContext;
}

interface ForwardedProcessRoute extends ProcessRouteOwner {
  readonly ppid: number;
  killRequested: boolean;
}

export interface SpawnOptions {
  /** Working directory for the child. Defaults to the parent's cwd. */
  cwd?: string;
  threadIdentity?: { readonly pid: number; readonly ppid: number };
  federated?: boolean;
}

/** Root cwd for processes that have no parent. */
export const DEFAULT_CWD = '/workspace';

/** Encoder for forwarded worker-error text pushed onto a child's stderr stream. */
const STDERR_ENCODER = new TextEncoder();
const PROCESS_RESERVE_RPC = 'process.reserve';
const PROCESS_COMMIT_RPC = 'process.commit';
const PROCESS_ABORT_RPC = 'process.abort';
const PROCESS_SETTLE_RPC = 'process.settle';
const PROCESS_LISTENING_RPC = 'process.listening';
const PROCESS_PEER_DEATH_RPC = 'process.peer-death';
const PROCESS_SNAPSHOT_RPC = 'process.snapshot';
const ROUTE_REMOTE_LISTENING = Symbol('ProcessManager.routeRemoteListening');
const ROUTE_REMOTE_PEER_DEATH = Symbol('ProcessManager.routeRemotePeerDeath');
const ROUTES_UPSTREAM = Symbol('ProcessManager.routesUpstream');
const HAS_LOCAL_AUTHORITY = Symbol('ProcessManager.hasLocalAuthority');
const VALIDATE_RESERVE_PARENT = Symbol('ProcessManager.validateReserveParent');
const VALIDATE_FORWARDED = Symbol('ProcessManager.validateForwarded');

function callRequiredUpstream(method: string, payload: unknown): unknown {
  const upstream = readKernelSyncApi();
  if (upstream === null) throw new Error(`${method}: upstream authority is unavailable`);
  return upstream.call(method, payload);
}

function throwCollectedErrors(label: string, errors: readonly unknown[]): void {
  if (errors.length === 0) return;
  if (errors.length === 1) throw errors[0];
  throw new AggregateError(errors, `${label}: ${errors.map((error) => String(error)).join('; ')}`);
}

interface ProcessFederationLease {
  readonly pid: number;
  commit(): void;
  abort(): void;
  settle(code: number | null, signal: string | null): void;
  peerDeath(error: Error): void;
  listening(control: ProcessListeningControl): void;
}

function reserveProcessFederation(
  enabled: boolean,
  command: string,
  ppid: number,
  cwd: string,
): ProcessFederationLease | null {
  if (!enabled) return null;
  const upstream = readKernelSyncApi();
  if (upstream === null) {
    throw new Error('process federation requested without an upstream kernel authority');
  }
  const pid = positivePid(
    upstream.call(PROCESS_RESERVE_RPC, { command, ppid, cwd }),
    'process.reserve reply',
  );
  let state: 'reserved' | 'committed' | 'closed' = 'reserved';
  return {
    pid,
    commit() {
      if (state !== 'reserved') return;
      upstream.call(PROCESS_COMMIT_RPC, { pid });
      state = 'committed';
    },
    abort() {
      if (state !== 'reserved') return;
      state = 'closed';
      upstream.call(PROCESS_ABORT_RPC, { pid });
    },
    settle(code, signal) {
      if (state !== 'committed') return;
      state = 'closed';
      upstream.call(PROCESS_SETTLE_RPC, { pid, code, signal });
    },
    peerDeath(error) {
      if (state !== 'committed') return;
      state = 'closed';
      upstream.call(PROCESS_PEER_DEATH_RPC, { pid, message: error.message });
    },
    listening(control) {
      if (state !== 'committed') return;
      upstream.call(PROCESS_LISTENING_RPC, {
        pid,
        ports: control.ports,
        previewScope: control.previewScope ?? null,
      });
    },
  };
}

function ttyDimension(value: number, name: 'cols' | 'rows'): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`TTY ${name} must be a positive safe integer; received ${value}`);
  }
  return value;
}

function controlSignal(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('process control signal must be a non-empty string');
  }
  return value;
}

function controlExitCode(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 255) {
    throw new RangeError('process control exit code must be an unsigned byte');
  }
  return value as number;
}

function listeningPorts(value: unknown): number[] {
  if (
    !Array.isArray(value) ||
    value.some(
      (port) => !Number.isSafeInteger(port) || (port as number) <= 0 || (port as number) > 65_535,
    ) ||
    new Set(value).size !== value.length
  ) {
    throw new TypeError('process listening ports must be unique valid TCP ports');
  }
  return [...(value as number[])];
}

export function decodeIpcFrame(value: unknown): IpcFrame {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('process control frame must be an object');
  }
  const kind = (value as Record<string, unknown>).kind;
  if (typeof kind !== 'string') throw new TypeError('process control frame kind must be a string');
  const fields = (names: readonly string[]): Record<string, unknown> =>
    rpcRecord(value, ['kind', ...names], 'process control frame');
  switch (kind) {
    case 'ipc:message': {
      const record = fields(['payload']);
      return { kind, payload: record.payload };
    }
    case 'ipc:tty-resize': {
      const record = fields(['cols', 'rows']);
      return {
        kind,
        cols: ttyDimension(record.cols as number, 'cols'),
        rows: ttyDimension(record.rows as number, 'rows'),
      };
    }
    case 'ipc:disconnect':
    case 'control:peer-closing':
      fields([]);
      return { kind };
    case 'control:signal':
    case 'control:self-signal': {
      const record = fields(['signal']);
      return { kind, signal: controlSignal(record.signal) };
    }
    case 'control:self-exit': {
      const record = fields(['code']);
      return { kind, code: controlExitCode(record.code) };
    }
    case 'control:kill-tree': {
      const record = fields(['pid', 'signal']);
      return {
        kind,
        pid: positivePid(record.pid, 'process control target'),
        signal: controlSignal(record.signal),
      };
    }
    case 'control:listening': {
      const hasScope = Object.prototype.hasOwnProperty.call(value, 'previewScope');
      const record = fields(hasScope ? ['ports', 'previewScope'] : ['ports']);
      const previewScope =
        record.previewScope === undefined ? undefined : controlSignal(record.previewScope);
      return {
        kind,
        ports: listeningPorts(record.ports),
        ...(previewScope === undefined ? {} : { previewScope }),
      };
    }
    default:
      throw new TypeError(`unknown process control frame kind ${kind}`);
  }
}

export class ProcessManager {
  private nextPid = 2; // PID 1 is reserved for the main worker.
  private readonly table: Map<number, ProcessRecord> = new Map();
  private readonly hiddenThreads = new Set<ProcessRecord>();
  private readonly pendingRemote = new Map<
    number,
    {
      readonly command: string;
      readonly ppid: number;
      readonly cwd: string;
      readonly upstreamAuthority: boolean;
    } & ProcessRouteOwner
  >();
  private readonly forwardedRoutes = new Map<number, ForwardedProcessRoute>();
  private readonly physicalRoutes = new WeakMap<SyncRpcCallerContext, ProcessRecord>();

  spawn(
    command: string,
    handler: (io: ProcessIO) => unknown | Promise<unknown>,
    ppid = 1,
    options: SpawnOptions = {},
  ): ProcessHandle {
    // Inherit parent's cwd snapshot (ADR-0019). A `ppid` that names an
    // already-exited process falls through to `DEFAULT_CWD` because the
    // sweep on exit removes the record from `table`.
    const parentRecord = this.table.get(ppid);
    const initialCwd = options.cwd ?? parentRecord?.cwd ?? DEFAULT_CWD;
    const federation = reserveProcessFederation(
      options.federated === true,
      command,
      ppid,
      initialCwd,
    );
    const pid = federation?.pid ?? this.allocateLocalPid();
    const parentToChild = new EventEmitter();
    const childToParent = new EventEmitter();
    const abortController = new AbortController();

    const record: ProcessRecord = {
      pid,
      ppid,
      treeParentPid: ppid,
      published: true,
      upstreamAuthority: federation !== null,
      remoteListening: false,
      command,
      cwd: initialCwd,
      exitCode: null,
      signalCode: null,
      parentToChild,
      handle: null,
      abortController,
      terminate: () => false,
      fail: () => false,
      peerFail: () => false,
    };
    const manager = this;

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
        return manager.killRecordTree(record, signal);
      }
    }

    const handle = new Handle();
    const settle = (code: number | null, signal: string | null): boolean => {
      if (!manager.isLive(record)) return false;
      const outcomePublished = handle.exitCode !== null || handle.signalCode !== null;
      const exitCode = outcomePublished ? handle.exitCode : code;
      const signalCode = outcomePublished ? handle.signalCode : signal;
      manager.terminateDescendants(pid, signalCode ?? 'SIGTERM');
      abortController.abort();
      if (!outcomePublished) {
        handle.exitCode = exitCode;
        handle.signalCode = signalCode;
        handle.emit('exit', exitCode, signalCode);
        handle.emit('close', exitCode, signalCode);
      }
      manager.finalize(record, handle, [parentToChild, childToParent]);
      federation?.settle(exitCode, signalCode);
      return true;
    };
    record.terminate = (signal) =>
      handle.exitCode === null && handle.signalCode === null && settle(null, signal);
    record.fail = (code) =>
      handle.exitCode === null && handle.signalCode === null && settle(code, null);
    record.peerFail = (error) => {
      if (!manager.isLive(record)) return false;
      manager.retireOwnerDescendants(record, error);
      abortController.abort();
      handle.emit('peererror', error);
      handle.emit('close', null, null);
      manager.finalize(record, handle, [parentToChild, childToParent]);
      return true;
    };
    childToParent.on('message', (msg) => handle.emit('message', msg));
    childToParent.on('stdout', (chunk) => handle.emit('stdout', chunk));
    childToParent.on('stderr', (chunk) => handle.emit('stderr', chunk));

    record.handle = handle;
    this.table.set(pid, record);
    try {
      federation?.commit();
    } catch (error) {
      record.terminate('SIGTERM');
      federation?.abort();
      throw error;
    }

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
      if (!manager.isLive(record)) return;
      if (handle.exitCode !== null || handle.signalCode !== null) {
        settle(handle.exitCode, handle.signalCode);
        return;
      }
      settle(exitCode, null);
    });

    return handle;
  }

  /**
   * Drop the per-PID record and clear listeners on `emitters` + `handle`.
   * Called from both spawn paths (kill + natural exit). The handle object
   * survives so callers can read `exitCode`. Idempotent.
   */
  private finalize(
    record: ProcessRecord,
    handle: ProcessHandle | null,
    emitters: EventEmitter[],
  ): void {
    if (!this.retire(record, emitters)) return;
    handle?.removeAllListeners();
  }

  /** Retire process authority now while preserving handle listeners until close. */
  private retire(record: ProcessRecord, emitters: EventEmitter[]): boolean {
    if (!this.isLive(record)) return false;
    const errors: unknown[] = [];
    if (record.physicalRoute !== undefined) {
      try {
        this.retirePhysicalRoutes(record);
      } catch (error) {
        errors.push(error);
      }
    }
    if (record.published) this.table.delete(record.pid);
    else this.hiddenThreads.delete(record);
    if (record.physicalRoute !== undefined) this.physicalRoutes.delete(record.physicalRoute);
    for (const e of emitters) e.removeAllListeners();
    throwCollectedErrors(`Worker owner PID ${String(record.pid)} route retirement failed`, errors);
    return true;
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

    const federation = reserveProcessFederation(
      options.federated === true,
      command,
      ppid,
      initialCwd,
    );
    const pid = options.threadIdentity?.pid ?? federation?.pid ?? this.allocateLocalPid();
    const processPpid = options.threadIdentity?.ppid ?? ppid;
    const published = options.threadIdentity === undefined;

    let spawnResult: ReturnType<typeof spawnKernelWorker>;
    try {
      spawnResult = spawnKernelWorker({ ...spec, cwd: initialCwd }, { pid, ppid: processPpid });
    } catch (error) {
      federation?.abort();
      throw error;
    }

    const abortController = new AbortController();
    const ports = spawnResult.ports;

    const record: ProcessRecord = {
      pid,
      ppid: processPpid,
      treeParentPid: ppid,
      published,
      upstreamAuthority: federation !== null,
      physicalRoute: spawnResult.callerContext,
      remoteListening: false,
      command,
      cwd: initialCwd,
      exitCode: null,
      signalCode: null,
      parentToChild: new EventEmitter(),
      handle: null,
      abortController,
      terminate: () => false,
      fail: () => false,
      peerFail: () => false,
    };

    // Captured by `WorkerHandle.kill` and the exit callback for sweeping.
    const manager = this;

    class WorkerHandle extends EventEmitter implements WorkerProcessHandle {
      readonly kind = 'worker' as const;
      readonly pid = pid;
      readonly ppid = processPpid;
      readonly command = command;
      exitCode: number | null = null;
      signalCode: string | null = null;
      readonly ports = ports;

      #stdoutReadable: Readable;
      #stderrReadable: Readable;
      #stdinWritable: Writable | null = null;

      // User IPC disconnect is logical: TTY/process controls keep using this
      // port until the worker exits (ADR-0225/0230).
      #ipcStarted = false;
      #ipcDisconnected = false;
      #controlClosed = false;
      #stdoutReceived = 0;
      #stderrReceived = 0;
      #stdoutExpected: number | null = null;
      #stderrExpected: number | null = null;
      #terminalOutcome: WorkerTerminalOutcome | null = null;
      #terminalFinishing = false;
      #terminalScheduled = false;
      #terminalAbandoned = false;
      #cutStarted = false;
      #terminalDiagnostic: Uint8Array | null = null;

      constructor() {
        super();
        this.#stdoutReadable = bindPortAsReadable(ports.stdout, {
          onChunk: () => this._markStdioChunk('stdout'),
          onProtocolError: (error) => this._failStdioProtocol(error),
        });
        this.#stderrReadable = bindPortAsReadable(ports.stderr, {
          onChunk: () => this._markStdioChunk('stderr'),
          onProtocolError: (error) => this._failStdioProtocol(error),
        });
      }

      get cwd(): string {
        return record.cwd;
      }
      setCwd(next: string): void {
        record.cwd = next;
      }
      stdout(): Readable {
        return this.#stdoutReadable;
      }
      stderr(): Readable {
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
          let frame: IpcFrame;
          try {
            frame = decodeIpcFrame(ev.data);
          } catch {
            manager.failRecord(record, 1);
            return;
          }
          if (frame.kind === 'ipc:message') {
            if (this.#ipcDisconnected) return;
            this.emit('message', frame.payload);
          } else if (frame.kind === 'ipc:disconnect') {
            this._disconnectIpc();
          } else if (frame.kind === 'control:listening') {
            const control = {
              pid: record.pid,
              ports: [...frame.ports],
              ...(frame.previewScope
                ? {
                    previewScope: frame.previewScope,
                  }
                : {}),
            };
            this.emit('control:listening', control);
            try {
              federation?.listening(control);
            } catch {
              manager.failRecord(record, 1);
            }
          } else if (frame.kind === 'control:peer-closing') {
            this._peerClose(new Error(`Worker peer for PID ${String(pid)} closed unexpectedly`));
          } else if (frame.kind === 'control:self-signal' && frame.signal === 'SIGUSR2') {
            manager.killRecordTree(record, frame.signal);
          } else if (frame.kind === 'control:self-exit') {
            this._settleAfterStdio(frame.code);
          } else {
            manager.failRecord(record, 1);
          }
        };
        ports.ipc.onmessageerror = () => {
          this._failStdioProtocol(
            new Error('Worker process-control port failed to deserialize a frame'),
          );
        };
        ports.ipc.start();
      }
      /** Internal: close user IPC without destroying the control transport. */
      _disconnectIpc(): void {
        if (this.#ipcDisconnected) return;
        this.#ipcDisconnected = true;
        this.emit('disconnect');
      }
      /** Internal: close the physical control transport after process exit. */
      _closeControl(): void {
        if (this.#controlClosed) return;
        this.#controlClosed = true;
        try {
          ports.ipc.close();
        } catch {
          /* peer may have closed already */
        }
        this._disconnectIpc();
      }
      /** Internal: push EOF on the read-side streams; called once on exit. */
      _signalEof(): void {
        this.#stdoutReadable.push(null);
        this.#stderrReadable.push(null);
        if (this.#stdinWritable && !this.#stdinWritable._writableState.ending) {
          this.#stdinWritable.end();
        }
      }
      _closeOutputPorts(): void {
        for (const port of [ports.stdout, ports.stderr]) {
          try {
            port.close();
          } catch {
            /* peer may have closed already */
          }
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
          this._closeControl();
          return false;
        }
      }
      resize(cols: number, rows: number): boolean {
        if (this.#controlClosed || this.exitCode !== null || this.signalCode !== null) {
          return false;
        }
        const frame: IpcFrame = {
          kind: 'ipc:tty-resize',
          cols: ttyDimension(cols, 'cols'),
          rows: ttyDimension(rows, 'rows'),
        };
        try {
          ports.ipc.postMessage(frame);
          return true;
        } catch {
          this._closeControl();
          return false;
        }
      }
      controlKill(targetPid: number, signal: string): boolean {
        if (this.#controlClosed || this.exitCode !== null || this.signalCode !== null) {
          return false;
        }
        try {
          ports.ipc.postMessage({
            kind: 'control:kill-tree',
            pid: targetPid,
            signal,
          } satisfies IpcFrame);
          return true;
        } catch {
          this._closeControl();
          return false;
        }
      }
      onListeningControl(listener: (control: ProcessListeningControl) => void): () => void {
        this.on('control:listening', listener as (...args: unknown[]) => void);
        return () => this.off('control:listening', listener as (...args: unknown[]) => void);
      }
      disconnect(): void {
        if (this.#ipcDisconnected) return;
        try {
          const frame: IpcFrame = { kind: 'ipc:disconnect' };
          ports.ipc.postMessage(frame);
        } catch {
          /* peer may have closed already */
        }
        this._disconnectIpc();
      }
      kill(signal = 'SIGTERM'): boolean {
        if (signal === 'SIGUSR2') {
          if (!manager.isLive(record)) return false;
          try {
            ports.ipc.postMessage({ kind: 'control:signal', signal } satisfies IpcFrame);
            return true;
          } catch {
            return manager.killRecordTree(record, signal);
          }
        }
        return manager.killRecordTree(record, signal);
      }
      _terminate(signal: string): boolean {
        return this._transition({ kind: 'signal', signal });
      }
      _fail(code: number): boolean {
        return this._transition({ kind: 'exit', code, cause: 'failure' });
      }
      _settleAfterStdio(code: number): void {
        this._transition({ kind: 'exit', code, cause: 'natural' });
      }
      _peerFail(error: Error): boolean {
        const outcome = { kind: 'peererror', error } satisfies WorkerTerminalOutcome;
        if (!this._acceptOutcome(outcome)) {
          if (manager.isLive(record)) {
            try {
              if (!isWorkerOutputChildSealed(spawnResult.spec.outputState)) {
                this._abandonTerminal();
              }
            } catch (failure) {
              this._failStdioProtocol(
                failure instanceof Error ? failure : new Error(String(failure)),
              );
            }
          }
          return false;
        }
        this._abandonTerminal();
        return true;
      }
      _peerClose(error: Error): boolean {
        let outputSealedByChild: boolean;
        try {
          outputSealedByChild = isWorkerOutputChildSealed(spawnResult.spec.outputState);
        } catch (failure) {
          this._failStdioProtocol(failure instanceof Error ? failure : new Error(String(failure)));
          return true;
        }
        if (!outputSealedByChild) {
          return this._peerFail(error);
        }
        return this._transition({ kind: 'peererror', error });
      }
      _markStdioChunk(stream: 'stdout' | 'stderr'): void {
        if (stream === 'stdout') this.#stdoutReceived++;
        else this.#stderrReceived++;
        const received = stream === 'stdout' ? this.#stdoutReceived : this.#stderrReceived;
        const expected = stream === 'stdout' ? this.#stdoutExpected : this.#stderrExpected;
        if (expected !== null && received > expected) {
          this._failStdioProtocol(
            new Error(
              `Worker ${stream} received ${String(received)} chunks after terminal target ${String(expected)}`,
            ),
          );
          return;
        }
        this._finishTerminalIfDrained();
      }
      _setStdioTarget(stream: 'stdout' | 'stderr', chunks: number): void {
        const current = stream === 'stdout' ? this.#stdoutExpected : this.#stderrExpected;
        if (current !== null && current !== chunks) {
          this._failStdioProtocol(
            new Error(
              `Worker ${stream} terminal target changed from ${String(current)} to ${String(chunks)}`,
            ),
          );
          return;
        }
        if (stream === 'stdout') this.#stdoutExpected = chunks;
        else this.#stderrExpected = chunks;
        const received = stream === 'stdout' ? this.#stdoutReceived : this.#stderrReceived;
        if (received > chunks) {
          this._failStdioProtocol(
            new Error(
              `Worker ${stream} received ${String(received)} chunks beyond terminal target ${String(chunks)}`,
            ),
          );
          return;
        }
        this._finishTerminalIfDrained();
      }
      _failStdioProtocol(error: Error): void {
        if (!manager.isLive(record) || this.#terminalFinishing) return;
        this._queueTerminalDiagnostic(`${error.message}\n`);
        const current = this.#terminalOutcome;
        if (current?.kind === 'signal' || current?.kind === 'peererror') {
          this._abandonTerminal();
          return;
        }
        const failure: WorkerTerminalOutcome = {
          kind: 'exit',
          code: 1,
          cause: 'failure',
          error,
        };
        this.#terminalOutcome = failure;
        this._abandonTerminal();
      }
      _transition(outcome: WorkerTerminalOutcome): boolean {
        if (!this._acceptOutcome(outcome)) return false;
        this._startOutputCut();
        return true;
      }
      _acceptOutcome(outcome: WorkerTerminalOutcome): boolean {
        if (!manager.isLive(record) || this.#terminalFinishing) return false;
        if (this.#terminalOutcome !== null) return false;
        this.#terminalOutcome = outcome;
        return true;
      }
      _workerError(message: string, outputSealedByChild: boolean): void {
        if (!manager.isLive(record) || this.#terminalFinishing) return;
        this._queueTerminalDiagnostic(message);
        if (this.#terminalOutcome !== null) {
          if (!outputSealedByChild) this._abandonTerminal();
          else this._finishTerminalIfDrained();
          return;
        }
        this.#terminalOutcome = {
          kind: 'exit',
          code: 1,
          cause: 'failure',
          error: new Error(message.trimEnd() || 'Worker terminated by an uncaught error'),
        };
        if (outputSealedByChild) {
          this._startOutputCut();
        } else {
          this._abandonTerminal();
        }
      }
      _startOutputCut(): void {
        if (this.#cutStarted || this.#terminalAbandoned) return;
        this.#cutStarted = true;
        let cut: ReturnType<typeof cutWorkerOutput>;
        try {
          cut = cutWorkerOutput(spawnResult.spec.outputState);
        } catch (error) {
          this._failStdioProtocol(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        if (!(cut instanceof Promise)) {
          this._applyOutputTargets(cut.stdout, cut.stderr);
          return;
        }
        void cut.then(
          ({ stdout, stderr }) => {
            this._applyOutputTargets(stdout, stderr);
          },
          (error: unknown) => {
            const failure = error instanceof Error ? error : new Error(String(error));
            this._failStdioProtocol(failure);
          },
        );
      }
      _applyOutputTargets(stdout: number, stderr: number): void {
        if (!manager.isLive(record) || this.#terminalFinishing || this.#terminalAbandoned) {
          return;
        }
        this._setStdioTarget('stdout', stdout);
        this._setStdioTarget('stderr', stderr);
      }
      _abandonTerminal(): void {
        if (!manager.isLive(record) || this.#terminalFinishing) {
          return;
        }
        this.#terminalAbandoned = true;
        try {
          abandonWorkerOutput(spawnResult.spec.outputState);
        } catch (error) {
          this._queueTerminalDiagnostic(
            `${error instanceof Error ? error.message : String(error)}\n`,
          );
        }
        this._emitTerminalDiagnostic();
        this._scheduleTerminalFinish();
      }
      _queueTerminalDiagnostic(message: string): void {
        if (this.#terminalDiagnostic !== null) return;
        this.#terminalDiagnostic = STDERR_ENCODER.encode(message);
      }
      _emitTerminalDiagnostic(): boolean {
        const diagnostic = this.#terminalDiagnostic;
        if (diagnostic === null) return false;
        this.#terminalDiagnostic = null;
        this.#stderrReadable.push(diagnostic);
        return true;
      }
      _finishTerminalIfDrained(): void {
        const outcome = this.#terminalOutcome;
        if (
          this.#terminalAbandoned ||
          outcome === null ||
          this.#stdoutExpected === null ||
          this.#stderrExpected === null ||
          this.#stdoutReceived !== this.#stdoutExpected ||
          this.#stderrReceived !== this.#stderrExpected
        ) {
          return;
        }
        const diagnosticEmitted = this._emitTerminalDiagnostic();
        if (this.#stdoutReceived === 0 && this.#stderrReceived === 0 && !diagnosticEmitted) {
          this._finishTerminal(outcome);
          return;
        }
        this._scheduleTerminalFinish();
      }
      _scheduleTerminalFinish(): void {
        if (this.#terminalScheduled || this.#terminalFinishing) return;
        this.#terminalScheduled = true;
        queueMicrotask(() => {
          this.#terminalScheduled = false;
          const outcome = this.#terminalOutcome;
          if (outcome === null || !manager.isLive(record) || this.#terminalFinishing) {
            return;
          }
          if (
            !this.#terminalAbandoned &&
            (this.#stdoutExpected === null ||
              this.#stderrExpected === null ||
              this.#stdoutReceived !== this.#stdoutExpected ||
              this.#stderrReceived !== this.#stderrExpected)
          ) {
            return;
          }
          this._finishTerminal(outcome);
        });
      }
      _finishTerminal(outcome: WorkerTerminalOutcome): void {
        if (
          !manager.isLive(record) ||
          this.#terminalOutcome !== outcome ||
          this.#terminalFinishing
        ) {
          return;
        }
        this.#terminalFinishing = true;
        if (outcome.kind === 'exit' && outcome.cause === 'failure') {
          manager.terminateDescendants(pid, 'SIGTERM');
        }
        abortController.abort();
        spawnResult.terminate();
        const reason =
          outcome.kind === 'peererror'
            ? outcome.error
            : outcome.kind === 'exit' && outcome.error !== undefined
              ? outcome.error
              : new Error(
                  `Worker owner PID ${String(pid)} ${
                    outcome.kind === 'signal'
                      ? 'terminated'
                      : outcome.cause === 'failure'
                        ? 'failed'
                        : 'exited'
                  }`,
                );
        manager.retireOwnerDescendants(record, reason);
        this._closeOutputPorts();
        this._signalEof();
        this._closeControl();
        if (outcome.kind === 'peererror') {
          this.emit('peererror', outcome.error);
          this._retireAndScheduleTerminalClose(null, null, () =>
            federation?.peerDeath(outcome.error),
          );
          return;
        }
        if (outcome.kind === 'signal') {
          this.signalCode = outcome.signal;
          this.exitCode = null;
          this.emit('exit', null, outcome.signal);
          this._retireAndScheduleTerminalClose(null, outcome.signal, () =>
            federation?.settle(null, outcome.signal),
          );
          return;
        }
        this.exitCode = outcome.code;
        this.signalCode = null;
        this.emit('exit', outcome.code, null);
        this._retireAndScheduleTerminalClose(outcome.code, null, () =>
          federation?.settle(outcome.code, null),
        );
      }
      _retireAndScheduleTerminalClose(
        code: number | null,
        signal: string | null,
        settleFederation: () => void,
      ): void {
        const errors: unknown[] = [];
        try {
          manager.retire(record, [record.parentToChild]);
        } catch (error) {
          errors.push(error);
        }
        this._scheduleTerminalClose(code, signal);
        try {
          settleFederation();
        } catch (error) {
          errors.push(error);
        }
        throwCollectedErrors(`Worker PID ${String(pid)} terminal settlement failed`, errors);
      }
      _scheduleTerminalClose(code: number | null, signal: string | null): void {
        // A flowing local Readable needs one turn to consume its final chunk
        // and one to emit 'end'. Node permits 'end' on either side of 'exit',
        // but ChildProcess 'close' follows stdio EOF.
        queueMicrotask(() => {
          queueMicrotask(() => {
            try {
              this.emit('close', code, signal);
            } finally {
              this.removeAllListeners();
            }
          });
        });
      }
    }

    const handle = new WorkerHandle();
    record.handle = handle;
    record.terminate = (signal) => handle._terminate(signal);
    record.fail = (code) => handle._fail(code);
    record.peerFail = (error) => handle._peerFail(error);
    if (published) this.table.set(pid, record);
    else this.hiddenThreads.add(record);
    this.physicalRoutes.set(spawnResult.callerContext, record);
    try {
      federation?.commit();
    } catch (error) {
      record.terminate('SIGTERM');
      federation?.abort();
      throw error;
    }

    // Start the IPC port AFTER `record.handle` is wired, so any synchronous
    // `'message'` / `'disconnect'` dispatch sees a fully-constructed
    // handle. The IPC port is otherwise inert (no auto-start).
    handle._startIpc();

    spawnResult.onExit((code) => {
      handle._settleAfterStdio(code);
    });

    // Surface `messageerror` events on the handle so callers don't have
    // to reach into `SpawnWorkerResult` (review §1.10).
    spawnResult.onMessageError((ev) => {
      handle.emit('messageerror', ev);
    });

    // A worker error that escaped worker-entry's try/catch left no child-side
    // stack. The handle appends the parent diagnostic only after all attested
    // child output, then schedules terminal delivery behind local Readable flow.
    spawnResult.onUncaughtError((message, outputSealedByChild) => {
      handle._workerError(message, outputSealedByChild);
    });

    return handle;
  }

  get(pid: number): ProcessHandle | null {
    return this.table.get(pid)?.handle ?? null;
  }

  list(): ProcessHandle[] {
    return [...this.table.values()]
      .map((record) => record.handle)
      .filter((handle): handle is ProcessHandle => handle !== null);
  }

  snapshot(): ProcessSnapshot[] {
    return [
      { pid: 1, ppid: 0, command: 'rifty' },
      ...[...this.table.values()]
        .filter((record) => record.published)
        .map(({ pid, ppid, command }) => ({ pid, ppid, command })),
    ];
  }

  kill(pid: number, signal = 'SIGTERM'): boolean {
    const record = this.table.get(pid);
    if (record !== undefined) return this.killRecordTree(record, signal);
    const route = this.forwardedRoutes.get(pid);
    if (route?.killRequested !== false) return false;
    const owner = this.physicalOwnerHandle(route.ownerPid, route.ownerRoute);
    if (owner?.kind !== 'worker' || !owner.controlKill(pid, signal)) return false;
    route.killRequested = true;
    return true;
  }

  private allocateLocalPid(): number {
    while (
      this.table.has(this.nextPid) ||
      this.pendingRemote.has(this.nextPid) ||
      this.forwardedRoutes.has(this.nextPid)
    ) {
      this.nextPid += 1;
    }
    return this.nextPid++;
  }

  reserveRemoteProcess(
    command: string,
    ppid: number,
    cwd: string,
    ownerPid: number,
    ownerRoute?: SyncRpcCallerContext,
  ): number {
    if (!this.ownsProcess(ownerPid, ppid)) {
      throw new Error(`process.reserve: ppid ${ppid} is outside caller ${ownerPid}'s subtree`);
    }
    const pid = this.allocateLocalPid();
    this.pendingRemote.set(pid, {
      command,
      ppid,
      cwd,
      ownerPid,
      ...(ownerRoute === undefined ? {} : { ownerRoute }),
      upstreamAuthority: false,
    });
    return pid;
  }

  reserveForwardedProcess(
    pid: number,
    command: string,
    ppid: number,
    cwd: string,
    ownerPid: number,
    ownerRoute?: SyncRpcCallerContext,
  ): void {
    if (this.table.has(pid) || this.pendingRemote.has(pid) || this.forwardedRoutes.has(pid)) {
      throw new Error(`process.reserve: forwarded PID ${pid} is already known`);
    }
    if (!this.ownsProcess(ownerPid, ppid)) {
      throw new Error(`process.reserve: ppid ${ppid} is outside caller ${ownerPid}'s subtree`);
    }
    this.pendingRemote.set(pid, {
      command,
      ppid,
      cwd,
      ownerPid,
      ...(ownerRoute === undefined ? {} : { ownerRoute }),
      upstreamAuthority: true,
    });
  }

  commitRemoteProcess(pid: number, ownerPid: number, ownerRoute?: SyncRpcCallerContext): void {
    const pending = this.pendingRemote.get(pid);
    if (pending === undefined || !this.sameRoute(pending, ownerPid, ownerRoute)) {
      throw new Error(`process.commit: PID ${pid} has no matching reservation`);
    }
    if (!this.ownsProcess(ownerPid, pending.ppid)) {
      this.pendingRemote.delete(pid);
      throw new Error(`process.commit: parent ${pending.ppid} is no longer owned by ${ownerPid}`);
    }
    this.pendingRemote.delete(pid);
    const { command, cwd, ppid, upstreamAuthority } = pending;
    if (upstreamAuthority) {
      this.forwardedRoutes.set(pid, {
        ppid,
        ownerPid,
        ...(ownerRoute === undefined ? {} : { ownerRoute }),
        killRequested: false,
      });
      return;
    }
    const record: ProcessRecord = {
      pid,
      ppid,
      treeParentPid: ppid,
      published: true,
      upstreamAuthority,
      remoteOwnerPid: ownerPid,
      ...(ownerRoute === undefined ? {} : { remoteOwnerRoute: ownerRoute }),
      remoteListening: false,
      command,
      cwd,
      exitCode: null,
      signalCode: null,
      parentToChild: new EventEmitter(),
      handle: null,
      abortController: new AbortController(),
      terminate: () => false,
      fail: () => false,
      peerFail: () => false,
    };
    let killRequested = false;
    record.terminate = (signal) => {
      if (!this.isLive(record) || killRequested) return false;
      const route = this.physicalOwnerHandle(ownerPid, ownerRoute);
      if (route?.kind !== 'worker' || !route.controlKill(pid, signal)) return false;
      killRequested = true;
      return true;
    };
    record.fail = () => false;
    record.peerFail = (error) => {
      if (!this.isLive(record)) return false;
      this.retireOwnerDescendants(record, error);
      record.abortController.abort(error);
      this.finalize(record, null, [record.parentToChild]);
      return true;
    };
    this.table.set(pid, record);
  }

  abortRemoteProcess(pid: number, ownerPid: number, ownerRoute?: SyncRpcCallerContext): void {
    const pending = this.pendingRemote.get(pid);
    if (this.sameRoute(pending, ownerPid, ownerRoute)) this.pendingRemote.delete(pid);
  }

  hasPendingRemoteProcess(pid: number): boolean {
    return this.pendingRemote.has(pid);
  }

  [ROUTES_UPSTREAM](pid: number): boolean {
    return (
      this.pendingRemote.get(pid)?.upstreamAuthority ??
      (this.forwardedRoutes.has(pid) ? true : undefined) ??
      this.table.get(pid)?.upstreamAuthority ??
      (readKernelProcessSpec()?.pid === pid ? true : undefined) ??
      false
    );
  }

  [HAS_LOCAL_AUTHORITY](): boolean {
    return [...this.table.values()].some((record) => record.published && !record.upstreamAuthority);
  }

  [VALIDATE_RESERVE_PARENT](ppid: number, ownerPid: number): void {
    if (!this.ownsProcess(ownerPid, ppid)) {
      throw new Error(`process.reserve: ppid ${ppid} is outside caller ${ownerPid}'s subtree`);
    }
  }

  [VALIDATE_FORWARDED](
    pid: number,
    ownerPid: number,
    ownerRoute: SyncRpcCallerContext | undefined,
    state: 'reserved' | 'committed',
    method: string,
  ): void {
    const route =
      state === 'reserved' ? this.pendingRemote.get(pid) : this.forwardedRoutes.get(pid);
    if (!this.sameRoute(route, ownerPid, ownerRoute)) {
      throw new Error(`${method}: PID ${pid} has no matching ${state} route`);
    }
  }

  [ROUTE_REMOTE_LISTENING](
    pid: number,
    ownerPid: number,
    ownerRoute: SyncRpcCallerContext | undefined,
    control: ProcessListeningControl,
  ): void {
    const record = this.table.get(pid);
    const forwarded = this.forwardedRoutes.get(pid);
    const owned = this.sameRoute(forwarded, ownerPid, ownerRoute);
    if (!owned && !this.sameRoute(record, ownerPid, ownerRoute, true)) {
      throw new Error(`process.listening: PID ${pid} has no matching remote owner`);
    }
    if (owned) return;
    const route = this.physicalOwnerHandle(ownerPid, ownerRoute);
    if (route?.kind !== 'worker') {
      throw new Error(`process.listening: owner PID ${ownerPid} has no live worker route`);
    }
    route.emit('control:listening', { ...control, pid });
    if (record !== undefined) record.remoteListening = control.ports.length > 0;
  }

  [ROUTE_REMOTE_PEER_DEATH](
    pid: number,
    ownerPid: number,
    ownerRoute: SyncRpcCallerContext | undefined,
    error: Error,
  ): void {
    const record = this.table.get(pid);
    const forwarded = this.forwardedRoutes.get(pid);
    const forwardedOwned = this.sameRoute(forwarded, ownerPid, ownerRoute);
    if (!forwardedOwned && !this.sameRoute(record, ownerPid, ownerRoute, true)) {
      throw new Error(`process.peer-death: PID ${pid} has no matching remote owner`);
    }
    if (forwardedOwned) {
      this.deleteForwardedSubtree(pid);
      return;
    }
    const owner = this.physicalOwnerHandle(ownerPid, ownerRoute);
    if (owner?.kind !== 'worker') {
      throw new Error(`process.peer-death: owner PID ${ownerPid} has no live worker route`);
    }
    if (record?.remoteListening) {
      owner.emit('control:listening', { pid, ports: [] } satisfies ProcessListeningControl);
      record.remoteListening = false;
    }
    record?.peerFail(error);
  }

  settleRemoteProcess(
    pid: number,
    ownerPid: number,
    code: number | null,
    signal: string | null,
    ownerRoute?: SyncRpcCallerContext,
  ): void {
    const record = this.table.get(pid);
    if (record === undefined) {
      if (this.sameRoute(this.forwardedRoutes.get(pid), ownerPid, ownerRoute)) {
        this.forwardedRoutes.delete(pid);
      }
      return;
    }
    if (!this.sameRoute(record, ownerPid, ownerRoute, true)) return;
    if (record.remoteListening) {
      const owner = this.physicalOwnerHandle(ownerPid, ownerRoute);
      if (owner?.kind !== 'worker') {
        throw new Error(`process.settle: owner PID ${ownerPid} has no live worker route`);
      }
      owner.emit('control:listening', { pid, ports: [] } satisfies ProcessListeningControl);
      record.remoteListening = false;
    }
    record.exitCode = code;
    record.signalCode = signal;
    record.abortController.abort();
    this.finalize(record, null, [record.parentToChild]);
  }

  spawnWorkerThread(
    spec: SpawnWorkerSpec,
    identity: { readonly pid: number; readonly ppid: number },
    options: SpawnOptions = {},
  ): ProcessHandle {
    return this.spawnWorker('worker_threads', spec, identity.pid, {
      ...options,
      threadIdentity: identity,
    });
  }

  private killRecordTree(record: ProcessRecord, signal: string): boolean {
    if (!this.isLive(record)) return false;
    if (!record.published) return record.terminate(signal);
    this.terminateDescendants(record.pid, signal);
    return record.terminate(signal);
  }

  private terminateDescendants(
    pid: number,
    signal: string,
    visited = new Set<ProcessRecord>(),
  ): void {
    const directChildren = [...this.table.values(), ...this.hiddenThreads].filter(
      (record) => record.treeParentPid === pid && !visited.has(record),
    );
    for (const child of directChildren) {
      visited.add(child);
      this.terminateDescendants(child.pid, signal, visited);
      if (this.isLive(child)) child.terminate(signal);
    }
  }

  private failRecord(record: ProcessRecord, code: number): boolean {
    return this.isLive(record) && record.fail(code);
  }

  private peerFailRecord(record: ProcessRecord, error: Error): boolean {
    return this.isLive(record) && record.peerFail(error);
  }

  private retireOwnerDescendants(record: ProcessRecord, error: Error): void {
    if (record.published) this.retirePeerDescendants(record.pid, error, new Set([record]));
  }

  private retirePeerDescendants(
    pid: number,
    error: Error,
    visited = new Set<ProcessRecord>(),
  ): void {
    const directChildren = [...this.table.values(), ...this.hiddenThreads].filter(
      (record) => record.treeParentPid === pid && !visited.has(record),
    );
    for (const child of directChildren) {
      visited.add(child);
      this.retirePeerDescendants(child.pid, error, visited);
      if (!this.isLive(child)) continue;
      if (child.remoteOwnerPid !== undefined) child.peerFail(error);
      else child.terminate('SIGTERM');
    }
  }

  private isLive(record: ProcessRecord): boolean {
    return record.published
      ? this.table.get(record.pid) === record
      : this.hiddenThreads.has(record);
  }

  private ownsProcess(ownerPid: number, candidatePid: number): boolean {
    let cursor = candidatePid;
    const seen = new Set<number>();
    while (!seen.has(cursor)) {
      if (cursor === ownerPid) return true;
      seen.add(cursor);
      const record = this.table.get(cursor);
      const parentPid = record?.ppid ?? this.forwardedRoutes.get(cursor)?.ppid;
      if (parentPid === undefined) return false;
      cursor = parentPid;
    }
    return false;
  }

  private physicalOwnerHandle(
    ownerPid: number,
    ownerRoute?: SyncRpcCallerContext,
  ): ProcessHandle | undefined {
    return (
      (ownerRoute === undefined ? this.table.get(ownerPid) : this.physicalRoutes.get(ownerRoute))
        ?.handle ?? undefined
    );
  }

  private isPhysicalOwner(
    record: ProcessRecord,
    ownerPid: number,
    ownerRoute?: SyncRpcCallerContext,
  ): boolean {
    return ownerRoute === undefined ? record.pid === ownerPid : record.physicalRoute === ownerRoute;
  }

  private sameRoute(
    candidate: ProcessRouteOwner | ProcessRecord | undefined,
    ownerPid: number,
    ownerRoute: SyncRpcCallerContext | undefined,
    remoteRecord = false,
  ): boolean {
    const candidatePid = remoteRecord
      ? (candidate as ProcessRecord | undefined)?.remoteOwnerPid
      : (candidate as ProcessRouteOwner | undefined)?.ownerPid;
    const candidateRoute = remoteRecord
      ? (candidate as ProcessRecord | undefined)?.remoteOwnerRoute
      : (candidate as ProcessRouteOwner | undefined)?.ownerRoute;
    return candidatePid === ownerPid && candidateRoute === ownerRoute;
  }

  private retirePhysicalRoutes(owner: ProcessRecord): void {
    const error = new Error(`Worker owner PID ${String(owner.pid)} closed`);
    const errors: unknown[] = [];
    const owns = (route: ProcessRouteOwner) =>
      this.isPhysicalOwner(owner, route.ownerPid, route.ownerRoute);
    for (const [pid, pending] of [...this.pendingRemote]) {
      if (!owns(pending)) continue;
      try {
        if (pending.upstreamAuthority) callRequiredUpstream(PROCESS_ABORT_RPC, { pid });
      } catch (failure) {
        errors.push(failure);
      } finally {
        this.pendingRemote.delete(pid);
      }
    }
    const forwarded = [...this.forwardedRoutes].filter(([, route]) => owns(route));
    const forwardedPids = new Set(forwarded.map(([pid]) => pid));
    for (const [pid, route] of forwarded) {
      if (forwardedPids.has(route.ppid)) continue;
      try {
        callRequiredUpstream(PROCESS_PEER_DEATH_RPC, { pid, message: error.message });
      } catch (failure) {
        errors.push(failure);
      } finally {
        this.deleteForwardedSubtree(pid);
      }
    }
    const remote = [...this.table.values()].filter(
      (record) =>
        record.remoteOwnerPid !== undefined &&
        this.isPhysicalOwner(owner, record.remoteOwnerPid, record.remoteOwnerRoute),
    );
    const remotePids = new Set(remote.map(({ pid }) => pid));
    for (const record of remote) {
      if (remotePids.has(record.ppid)) continue;
      try {
        record.peerFail(error);
      } catch (failure) {
        errors.push(failure);
      }
    }
    throwCollectedErrors(
      `Worker owner PID ${String(owner.pid)} descendant retirement failed`,
      errors,
    );
  }

  private deleteForwardedSubtree(pid: number): void {
    const descendants = [...this.forwardedRoutes]
      .filter(([, route]) => route.ppid === pid)
      .map(([childPid]) => childPid);
    for (const childPid of descendants) this.deleteForwardedSubtree(childPid);
    this.forwardedRoutes.delete(pid);
  }
}

export const globalProcessManager = new ProcessManager();
installProcessFederation(globalProcessManager);

function processSnapshot(value: unknown): ProcessSnapshot[] {
  if (!Array.isArray(value)) throw new TypeError('process.snapshot reply must be an array');
  const seen = new Set<number>();
  return value.map((entry) => {
    const record = rpcRecord(entry, ['pid', 'ppid', 'command'], 'process.snapshot row');
    const pid = positivePid(record.pid, 'process.snapshot pid');
    if (seen.has(pid)) throw new TypeError(`process.snapshot contains duplicate PID ${pid}`);
    seen.add(pid);
    if (!Number.isSafeInteger(record.ppid) || (record.ppid as number) < 0) {
      throw new TypeError('process.snapshot ppid must be a non-negative safe integer');
    }
    return {
      pid,
      ppid: record.ppid as number,
      command: rpcString(record.command, 'process.snapshot command'),
    };
  });
}

export function readRootProcessSnapshot(): ProcessSnapshot[] {
  const upstream = readKernelSyncApi();
  return upstream === null || globalProcessManager[HAS_LOCAL_AUTHORITY]()
    ? globalProcessManager.snapshot()
    : processSnapshot(upstream.call(PROCESS_SNAPSHOT_RPC, {}));
}

export function formatProcessSnapshot(
  args: readonly string[],
  rows: readonly ProcessSnapshot[],
): string | null {
  if (args.length === 0) {
    return [
      '  PID TTY          TIME CMD',
      ...rows.map(({ pid, command }) => `${String(pid).padStart(5)} ?        00:00:00 ${command}`),
      '',
    ].join('\n');
  }
  if (args.length === 3 && args[0] === '-A' && args[1] === '-o' && args[2] === 'ppid,pid') {
    return [
      ' PPID   PID',
      ...rows.map(({ ppid, pid }) => `${String(ppid).padStart(5)} ${String(pid).padStart(5)}`),
      '',
    ].join('\n');
  }
  return null;
}

function positivePid(value: unknown, owner: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new TypeError(`${owner} must be a positive safe integer PID`);
  }
  return value as number;
}

function rpcRecord(
  value: unknown,
  fields: readonly string[],
  owner: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${owner} payload must be an object`);
  }
  const record = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(record);
  if (
    keys.length !== fields.length ||
    fields.some((field) => !Object.prototype.hasOwnProperty.call(record, field))
  ) {
    throw new TypeError(`${owner} payload must contain exactly ${fields.join(', ')}`);
  }
  return record;
}

function rpcOwner(
  context: SyncRpcCallerContext | undefined,
  method: string,
): { readonly pid: number; readonly route: SyncRpcCallerContext } {
  return {
    pid: positivePid(context?.callerPid, `${method} caller`),
    route: context as SyncRpcCallerContext,
  };
}

function rpcString(value: unknown, owner: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${owner} must be a non-empty string`);
  }
  return value;
}

export function installProcessFederation(manager: ProcessManager): void {
  const dispatcher = getKernelDispatcher();
  const relayOptional = (method: string, payload: unknown): unknown => {
    const upstream = readKernelSyncApi();
    return upstream?.call(method, payload);
  };
  const relayKnown = (
    method: string,
    payload: unknown,
    pid: number,
    ownerPid: number,
    ownerRoute: SyncRpcCallerContext,
    state: 'reserved' | 'committed',
  ): unknown => {
    if (!manager[ROUTES_UPSTREAM](pid)) return undefined;
    manager[VALIDATE_FORWARDED](pid, ownerPid, ownerRoute, state, method);
    return callRequiredUpstream(method, payload);
  };
  dispatcher.register(PROCESS_RESERVE_RPC, (payload, context) => {
    const record = rpcRecord(payload, ['command', 'ppid', 'cwd'], PROCESS_RESERVE_RPC);
    const ppid = positivePid(record.ppid, 'process.reserve ppid');
    const command = rpcString(record.command, 'process.reserve command');
    const cwd = rpcString(record.cwd, 'process.reserve cwd');
    const { pid: ownerPid, route: ownerRoute } = rpcOwner(context, PROCESS_RESERVE_RPC);
    manager[VALIDATE_RESERVE_PARENT](ppid, ownerPid);
    const relayed = manager[ROUTES_UPSTREAM](ppid)
      ? callRequiredUpstream(PROCESS_RESERVE_RPC, payload)
      : undefined;
    if (relayed === undefined) {
      return manager.reserveRemoteProcess(command, ppid, cwd, ownerPid, ownerRoute);
    }
    const pid = positivePid(relayed, 'process.reserve relay reply');
    try {
      manager.reserveForwardedProcess(pid, command, ppid, cwd, ownerPid, ownerRoute);
    } catch (error) {
      try {
        callRequiredUpstream(PROCESS_ABORT_RPC, { pid });
      } catch (abortError) {
        throw new AggregateError([error, abortError], 'process.reserve rollback failed');
      }
      throw error;
    }
    return pid;
  });
  dispatcher.register(PROCESS_COMMIT_RPC, (payload, context) => {
    const record = rpcRecord(payload, ['pid'], PROCESS_COMMIT_RPC);
    const pid = positivePid(record.pid, 'process.commit pid');
    const { pid: ownerPid, route: ownerRoute } = rpcOwner(context, PROCESS_COMMIT_RPC);
    const relayed = relayKnown(PROCESS_COMMIT_RPC, payload, pid, ownerPid, ownerRoute, 'reserved');
    manager.commitRemoteProcess(pid, ownerPid, ownerRoute);
    if (relayed !== undefined) return relayed;
    return null;
  });
  dispatcher.register(PROCESS_ABORT_RPC, (payload, context) => {
    const record = rpcRecord(payload, ['pid'], PROCESS_ABORT_RPC);
    const pid = positivePid(record.pid, 'process.abort pid');
    const { pid: ownerPid, route: ownerRoute } = rpcOwner(context, PROCESS_ABORT_RPC);
    const relayed = relayKnown(PROCESS_ABORT_RPC, payload, pid, ownerPid, ownerRoute, 'reserved');
    manager.abortRemoteProcess(pid, ownerPid, ownerRoute);
    if (relayed !== undefined) return relayed;
    return null;
  });
  dispatcher.register(PROCESS_SETTLE_RPC, (payload, context) => {
    const record = rpcRecord(payload, ['pid', 'code', 'signal'], PROCESS_SETTLE_RPC);
    const pid = positivePid(record.pid, 'process.settle pid');
    const code =
      record.code === null
        ? null
        : Number.isSafeInteger(record.code) && (record.code as number) >= 0
          ? (record.code as number)
          : (() => {
              throw new TypeError('process.settle code must be null or a non-negative integer');
            })();
    const signal =
      record.signal === null ? null : rpcString(record.signal, 'process.settle signal');
    if ((code === null) === (signal === null)) {
      throw new TypeError('process.settle requires exactly one of code or signal');
    }
    const { pid: ownerPid, route: ownerRoute } = rpcOwner(context, PROCESS_SETTLE_RPC);
    const relayed = relayKnown(PROCESS_SETTLE_RPC, payload, pid, ownerPid, ownerRoute, 'committed');
    manager.settleRemoteProcess(pid, ownerPid, code, signal, ownerRoute);
    if (relayed !== undefined) return relayed;
    return null;
  });
  dispatcher.register(PROCESS_LISTENING_RPC, (payload, context) => {
    const record = rpcRecord(payload, ['pid', 'ports', 'previewScope'], PROCESS_LISTENING_RPC);
    const pid = positivePid(record.pid, 'process.listening pid');
    const previewScope =
      record.previewScope === null
        ? undefined
        : rpcString(record.previewScope, 'process.listening previewScope');
    let control: ProcessListeningControl;
    try {
      const frame = decodeIpcFrame({
        kind: 'control:listening',
        ports: record.ports,
        ...(previewScope === undefined ? {} : { previewScope }),
      });
      if (frame.kind !== 'control:listening') throw new TypeError('unreachable frame kind');
      control = {
        pid,
        ports: [...frame.ports],
        ...(frame.previewScope
          ? {
              previewScope: frame.previewScope,
            }
          : {}),
      };
    } catch {
      throw new TypeError('process.listening ports must be unique valid TCP ports');
    }
    const { pid: ownerPid, route: ownerRoute } = rpcOwner(context, PROCESS_LISTENING_RPC);
    const relayed = relayKnown(
      PROCESS_LISTENING_RPC,
      payload,
      pid,
      ownerPid,
      ownerRoute,
      'committed',
    );
    manager[ROUTE_REMOTE_LISTENING](pid, ownerPid, ownerRoute, control);
    if (relayed !== undefined) return relayed;
    return null;
  });
  dispatcher.register(PROCESS_PEER_DEATH_RPC, (payload, context) => {
    const record = rpcRecord(payload, ['pid', 'message'], PROCESS_PEER_DEATH_RPC);
    const pid = positivePid(record.pid, 'process.peer-death pid');
    const { pid: ownerPid, route: ownerRoute } = rpcOwner(context, PROCESS_PEER_DEATH_RPC);
    const error = new Error(rpcString(record.message, 'process.peer-death message'));
    const relayed = relayKnown(
      PROCESS_PEER_DEATH_RPC,
      payload,
      pid,
      ownerPid,
      ownerRoute,
      'committed',
    );
    manager[ROUTE_REMOTE_PEER_DEATH](pid, ownerPid, ownerRoute, error);
    if (relayed !== undefined) return relayed;
    return null;
  });
  dispatcher.register(PROCESS_SNAPSHOT_RPC, (payload) => {
    rpcRecord(payload, [], PROCESS_SNAPSHOT_RPC);
    const relayed = manager[HAS_LOCAL_AUTHORITY]()
      ? undefined
      : relayOptional(PROCESS_SNAPSHOT_RPC, payload);
    return relayed === undefined ? manager.snapshot() : relayed;
  });
}

/**
 * Wrap the raw `MessagePort` triple as `@riftydev/io` streams: push-side
 * `Readable` and post-side `Writable`. Kept here as they're only meaningful
 * for a `WorkerProcessHandle`.
 */
interface WorkerStdioReadableEvents {
  onChunk(): void;
  onProtocolError(error: Error): void;
}

function bindPortAsReadable(port: MessagePort, events: WorkerStdioReadableEvents): Readable {
  const r = new Readable({ read() {} });
  port.onmessage = (ev: MessageEvent) => {
    const data = ev.data;
    if (data instanceof Uint8Array) {
      r.push(data);
      events.onChunk();
      return;
    }
    events.onProtocolError(new Error('Worker stdio received a malformed frame'));
  };
  port.onmessageerror = () => {
    events.onProtocolError(new Error('Worker stdio failed to deserialize a frame'));
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
        port.postMessage({ kind: 'stdin:eof' });
        port.close();
        cb();
      } catch (err) {
        cb(err instanceof Error ? err : new Error(String(err)));
      }
    },
  });
}
