/**
 * The bridge contract between the guest bundle and its embedder (ADR-0558).
 * Shared by the bundle and the host side; no Node or embedder import here.
 * Unstable: any release may change it (README §Versions).
 */

/** What the guest can call on the host. Every argument is guest-controlled. */
export interface HostFunctions {
  /** Guest stdout (1) / stderr (2) bytes. */
  write(fd: 1 | 2, bytes: Uint8Array): void;
  /** Arm host timer `id` (1..2^31-1) for `ms` (0..2^31-1); expiry → `GuestEntry.fire(id)`. */
  timerStart(id: number, ms: number, repeat: boolean): void;
  timerClear(id: number): void;
  /** ms since `timeOrigin`. */
  now(): number;
  /** `byteLength` (0..65536) random bytes. */
  random(byteLength: number): Uint8Array;
}

/** `globalThis.__riftyIsolateHost`, set by the embedder before the bundle runs. */
export interface GuestHost extends HostFunctions {
  /** `performance.timeOrigin` of the host, epoch ms. */
  readonly timeOrigin: number;
}

/** `globalThis.__riftyGuest`, defined by the bundle; the embedder takes it before `run`. */
export interface GuestEntry {
  /** Run `code` like `node -e`, once. Resolves with the exit status (judge it with `exitStatus`). */
  run(code: string): Promise<number>;
  /** Host timer `id` expired. */
  fire(id: number): void;
  /** An unhandled rejection the embedder saw: a copy of the reason, or `UNCOPYABLE_REJECTION`. */
  rejection(reason: unknown): void;
}

/** Sent to `rejection` when the reason cannot be copied out of the isolate. */
export const UNCOPYABLE_REJECTION = 'isolate-host:uncopyable-rejection-reason';

/** The stderr line (prefixed `Error: `) a guest `import()` ends its run with. */
export const IMPORT_GAP =
  'Not implemented: isolate-host.dynamic-import (import() is not available in the rifty isolate host; use require(), ADR-0557)';
