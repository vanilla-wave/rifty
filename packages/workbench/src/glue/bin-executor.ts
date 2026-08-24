/** Type contracts shared by the owner-child bin executor and preview hooks. */
import type { CommandContext } from '@riftydev/shell';
import type { ForegroundListeningControl, ForegroundWritable } from './run-foreground-child.ts';

/** Read-side of a worker stdio stream (subset of `@riftydev/io` `Readable`). */
export interface BinReadable {
  on(event: 'data', listener: (chunk: unknown) => void): unknown;
}

/**
 * Worker handle surface the executor needs (subset of `WorkerProcessHandle`).
 * `on('message')` is part of the shared `ForegroundChildHandle` contract (the
 * real handle has it); a bin child never sends messages, so the driver never
 * subscribes — it is declared only to satisfy the shared type.
 */
export interface BinWorkerHandle {
  stdout(): BinReadable;
  stderr(): BinReadable;
  stdin(): ForegroundWritable;
  on(event: 'exit', listener: (code?: unknown, signal?: unknown) => void): unknown;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  onListeningControl?: (listener: (control: ForegroundListeningControl) => void) => unknown;
  send?(message: unknown): unknown;
  resize(cols: number, rows: number): unknown;
  kill(signal?: string): unknown;
}

/** Spawn request: the executor builds this; the host maps it to a Worker spec. */
export interface BinSpawnRequest {
  /** Absolute resolved Node-entry path — `argv[1]`; `.bin` paths are launcher shims. */
  readonly shimPath: string;
  readonly args: readonly string[];
  readonly env: Record<string, string>;
  readonly cwd: string;
  readonly isTTY: boolean;
  readonly cols?: number;
  readonly rows?: number;
  /** Host-minted preview correlation; never part of guest `process.env`. */
  readonly previewScope?: string;
  /** Host-only physical root behind the child process's public `/` namespace. */
  readonly remoteFsRoot?: string;
}

export interface BinExecutorDeps {
  /** Optional lifecycle hook for owners that mirror server-capable bins into UI state. */
  readonly onStart?: (req: BinSpawnRequest, ctx: CommandContext) => void;
  /** Optional child handle hook for owners that need to send control messages. */
  readonly onSpawn?: (req: BinSpawnRequest, handle: BinWorkerHandle, ctx: CommandContext) => void;
  /** Optional child→owner IPC hook (e.g. listened ports from server-capable bins). */
  readonly onMessage?: (req: BinSpawnRequest, message: unknown, ctx: CommandContext) => void;
  /** Private child→owner listening control; never exposed through guest IPC. */
  readonly onListening?: (
    req: BinSpawnRequest,
    control: ForegroundListeningControl,
    ctx: CommandContext,
  ) => void;
  /** Optional exit hook (runs before the executor promise resolves). */
  readonly onExit?: (req: BinSpawnRequest, ctx: CommandContext) => void;
}
