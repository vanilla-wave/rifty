/**
 * `child_process.execSync` (ADR-0011 phase 3).
 *
 * Lives in its own module so the public `child_process.ts` stays inside
 * the workspace file budget (300 lines). Holds the SAB-vs-fallback branch
 * for synchronous child execution.
 */

import { Buffer } from '@rifty/io';
import {
  KERNEL_SYNC_CALL_KEY,
  type KernelSyncCall,
  getKernelWorkerUrl,
  isSabIpcSupported,
} from '@rifty/kernel';
import { syncMirror } from './fs-sync-mirror.ts';

export interface ExecSyncOptions {
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly encoding?: string;
  readonly maxBuffer?: number;
}

/**
 * `execSync` — Node-compatible synchronous child execution.
 *
 * Branching:
 *   - If we are inside a kernel-spawned Worker (the `KERNEL_SYNC_CALL_KEY`
 *     global is installed), route through the sync RPC hook. The parent
 *     dispatcher spawns a fresh Worker for the child script and uses
 *     `Atomics.wait` to block this realm until the child's stdout is
 *     captured. This is the only path that truly blocks the caller — see
 *     ADR-0011 §Decision.
 *   - Otherwise — when SAB IPC is not available, when the host hasn't
 *     wired `setKernelWorkerUrl`, or when we are in the main realm where
 *     `Atomics.wait` would freeze the page — fall back to the in-realm
 *     `new Function(...)` path that has shipped since M6. This path is
 *     marked as a fallback per ADR-0011 phases 2/3.
 */
export function execSync(cmd: string, opts?: ExecSyncOptions): Uint8Array {
  const hook = getKernelSyncCall();
  if (hook !== undefined && isSabIpcSupported() && getKernelWorkerUrl() !== null) {
    const stdout = hook('execSync', { cmd, opts: opts ?? {} });
    if (typeof stdout !== 'string') {
      throw new TypeError(
        `execSync: kernel returned non-string stdout (${typeof stdout}); JSON framing should always produce a string`,
      );
    }
    return Buffer.from(stdout, 'utf8');
  }
  // fallback per ADR-0011 phases 2/3 — in-realm `new Function` evaluation.
  // Stays available behind the capability gate for non-isolated test
  // environments and the page realm itself (where Atomics.wait would
  // freeze the UI). Existing 5 child_process conformance tests exercise
  // this path.
  const tokens = cmd.split(/\s+/).filter(Boolean);
  if (tokens[0] !== 'node' || tokens.length < 2) {
    throw Object.assign(new Error(`execSync only supports 'node <script>': got ${cmd}`), {
      code: 'EUNSUPPORTED',
    });
  }
  const scriptPath = tokens[1] ?? '';
  let stdout = '';
  const source = syncMirror().readFileBytesSync(scriptPath);
  const fn = new Function(
    '__stdout_write',
    `${Buffer.from(source).toString()}\n//# sourceURL=${scriptPath}`,
  ) as (w: (c: string) => void) => unknown;
  fn((c) => {
    stdout += c;
  });
  return Buffer.from(stdout);
}

/**
 * Narrow accessor for the in-Worker sync call shim installed by
 * `worker-entry.ts`. Reads `globalThis[KERNEL_SYNC_CALL_KEY]` through a
 * shape-typed cast so no `any` leaks into the surrounding code.
 */
function getKernelSyncCall(): KernelSyncCall | undefined {
  const g = globalThis as { [KERNEL_SYNC_CALL_KEY]?: KernelSyncCall };
  return g[KERNEL_SYNC_CALL_KEY];
}
