/**
 * The bridge contract between the guest bundle and its embedder (ADR-0558).
 * Shared by the bundle and the host side; no Node or embedder import here.
 * Unstable: any release may change it (README §Versions).
 */
import type { SnapshotOptions } from './snapshot.ts';

/** What the guest can call on the host. Every argument is guest-controlled. */
export interface HostFunctions {
  /** Guest stdout (1) / stderr (2) bytes. */
  write(fd: 1 | 2, bytes: Uint8Array): void;
  /** Arm host timer `id` (1..2^31-1) for `ms` (0..2^31-1); expiry → `GuestEntry.fire(id)`. */
  timerStart(id: number, ms: number, repeat: boolean): void;
  timerClear(id: number): void;
  /** ms since `timeOrigin` (the call's start). */
  now(): number;
  /** `byteLength` (0..65536) random bytes. */
  random(byteLength: number): Uint8Array;
}

/** `globalThis.__riftyIsolateHost`, set by the embedder before the bundle runs. */
export interface GuestHost extends HostFunctions {
  /** Set before bundle load in a fresh context. Omitted or true permits shared buffers. */
  readonly allowSharedArrayBuffer?: boolean;
  /** The call's start, epoch ms (`HostBridge.timeOrigin`). */
  readonly timeOrigin: number;
}

/** `globalThis.__riftyGuest`, defined by the bundle; the embedder takes it before `run`. */
export interface GuestEntry {
  /** Run `code` like `node -e`, once. Resolves with the exit status (judge it with `exitStatus`). */
  run(code: string): Promise<number>;
  /**
   * `node <path> [args]` over this realm's FS, cwd `/workspace`, once, instead
   * of `run` (ADR-0568). Resolves with the exit status (judge it with `exitStatus`).
   */
  runFile(path: string, args: readonly string[]): Promise<number>;
  /** Host timer `id` expired. */
  fire(id: number): void;
  /** An unhandled rejection the embedder saw: a copy of the reason, or `UNCOPYABLE_REJECTION`. */
  rejection(reason: unknown): void;
  /** The realm's whole FS as a snapshot (ADR-0567); whenever no guest code runs, after `run` included. */
  snapshot(options: SnapshotOptions): Uint8Array;
  /** Replace the realm's FS with a snapshot; only before `run`, else `ERR_FS_SNAPSHOT_NOT_FRESH`. */
  restore(bytes: Uint8Array, options: SnapshotOptions): void;
}

/** Sent to `rejection` when the reason cannot be copied out of the isolate. */
export const UNCOPYABLE_REJECTION = 'isolate-host:uncopyable-rejection-reason';

/** The stderr line (prefixed `Error: `) a guest `import()` ends its run with. */
/**
 * The directories a fresh guest FS holds: the cwd and rifty's `os.tmpdir()`,
 * both present for any `node` on a machine. A sandbox's first state too (ADR-0568).
 */
export const GUEST_DIRS: readonly string[] = ['/workspace', '/tmp'];

export const IMPORT_GAP =
  'Not implemented: isolate-host.dynamic-import (import() is not available in the rifty isolate host; use require(), ADR-0557)';
