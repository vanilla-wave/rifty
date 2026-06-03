/**
 * `child_process.execSync` (ADR-0011 phase 3).
 *
 * Lives in its own module so the public `child_process.ts` stays inside the
 * workspace structure-by-concept layout. Holds the SAB-vs-loud-throw branch
 * for synchronous child execution.
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
 * Branching:
 *   - If we are inside a kernel-spawned Worker (the kernel sync API is
 *     published — see `@riftydev/kernel.readKernelSyncApi`), route through the
 *     sync RPC hook. The parent dispatcher spawns a fresh Worker for the
 *     child script and uses `Atomics.wait` to block this realm until the
 *     child's stdout is captured. This is the only path that truly blocks
 *     the caller — see ADR-0011 §Decision.
 *   - Otherwise — when SAB IPC is unavailable, when the host hasn't wired
 *     `setKernelWorkerUrl`, or when we are in the main realm where
 *     `Atomics.wait` would freeze the page — throw `NotImplementedError`.
 *     The previous in-realm `new Function(...)` fallback was a silent
 *     stub: it evaluated user code in the parent realm without an exit
 *     code, without stdio isolation, and without a PID, while pretending to
 *     be a child process. Per CLAUDE.md "no silent stubs" and the
 *     2026-05-27 architecture review (item #2 in
 *     `docs/follow-ups-architecture-review-2026-05-27.md`), the fallback
 *     is replaced by a loud throw that names the missing capability.
 */
export function execSync(cmd: string, opts?: ExecSyncOptions): Uint8Array {
  const api = readKernelSyncApi();
  if (api !== null && isSabIpcSupported() && getKernelWorkerUrl() !== null) {
    const stdout = api.call('execSync', { cmd, opts: opts ?? {} });
    if (typeof stdout !== 'string') {
      throw new TypeError(
        `execSync: kernel returned non-string stdout (${typeof stdout}); JSON framing should always produce a string`,
      );
    }
    return Buffer.from(stdout, 'utf8');
  }
  throw new NotImplementedError(
    'child_process.execSync',
    'requires SharedArrayBuffer + cross-origin isolation (COOP/COEP) and a SAB-capable kernel Worker realm. ' +
      'Check the page is `crossOriginIsolated === true`, `isSabIpcSupported()` is true, and that the host called ' +
      '`setKernelWorkerUrl(...)` so kernel-spawned Workers can resolve. The previous in-realm fallback was a ' +
      'silent stub (CLAUDE.md "no silent stubs" / 2026-05-27 audit item #2).',
  );
}
