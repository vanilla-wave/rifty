/**
 * `child_process.execSync` (ADR-0011 phase 3).
 *
 * Own module so `child_process.ts` stays structure-by-concept; holds the
 * SAB-vs-loud-throw branch for synchronous child execution.
 */

import { Buffer, NotImplementedError } from '@riftydev/io';
import { getKernelWorkerUrl, isSabIpcSupported, readKernelSyncApi } from '@riftydev/kernel';

export interface ExecSyncOptions {
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly encoding?: string;
  readonly maxBuffer?: number;
}

/**
 * `execSync` — Node-compatible synchronous child execution.
 *
 * Inside a kernel-spawned Worker (sync API published), routes through the sync
 * RPC hook: the parent dispatcher spawns a fresh Worker for the child and
 * `Atomics.wait`s to block this realm until stdout is captured — the only path
 * that truly blocks the caller (ADR-0011 §Decision).
 *
 * Otherwise (no SAB IPC, no `setKernelWorkerUrl`, or main realm where
 * `Atomics.wait` would freeze the page) throws `NotImplementedError`. The old
 * in-realm `new Function(...)` fallback was a silent stub — ran user code in
 * the parent realm with no exit code, stdio isolation, or PID while posing as a
 * child. Replaced by a loud throw per CLAUDE.md "no silent stubs" + 2026-05-27
 * review item #2 (`docs/follow-ups-architecture-review-2026-05-27.md`).
 */
export function execSync(cmd: string, opts?: ExecSyncOptions): Uint8Array {
  const api = readKernelSyncApi();
  if (api !== null && isSabIpcSupported() && getKernelWorkerUrl() !== null) {
    const stdout = api.call('execSync', { cmd, opts: opts ?? {} });
    // ADR-0084 #23: the kernel returns the child's stdout as raw bytes over a
    // binary frame (Node returns a Buffer by default). No re-encode — the old
    // string path mangled non-UTF-8 stdout to U+FFFD.
    if (!(stdout instanceof Uint8Array)) {
      throw new TypeError(
        `execSync: kernel returned non-bytes stdout (${typeof stdout}); the v2 binary frame should always produce a Uint8Array`,
      );
    }
    return Buffer.from(stdout);
  }
  throw new NotImplementedError(
    'child_process.execSync',
    'requires SharedArrayBuffer + cross-origin isolation (COOP/COEP) and a SAB-capable kernel Worker realm. ' +
      'Check the page is `crossOriginIsolated === true`, `isSabIpcSupported()` is true, and that the host called ' +
      '`setKernelWorkerUrl(...)` so kernel-spawned Workers can resolve. The previous in-realm fallback was a ' +
      'silent stub (CLAUDE.md "no silent stubs" / 2026-05-27 audit item #2).',
  );
}
