// apps/playground/src/workers/worker-runtime-globals.ts
/**
 * Fork-IPC handle accessor for worker realms (ADR-0157).
 *
 * Under ADR-0157 the kernel pre-entry seam installs ONE spec-seeded rich
 * `process` (correct stdout/stderr/env + ADR-0045 fork-IPC `send`/`on`) before
 * any bootstrap runs — there is no longer a `globalThis.process` swap to undo.
 * So this no longer installs anything: it just reads the fork-IPC `send`/`on`
 * surface off the already-installed `globalThis.process` and returns it as the
 * `KernelIpc` handle the owner + dev-server bootstraps post page frames over.
 *
 * Name kept (callers: real-vite-bootstrap, dev-server-child-bootstrap) — the
 * swap-then-re-patch dance it used to perform is gone.
 */

export interface ProcStdio {
  stdout?: { write?: unknown };
  stderr?: { write?: unknown };
  env?: Record<string, string | undefined>;
  on?(event: 'message', handler: (message: unknown) => void): unknown;
  send?(message: unknown): unknown;
}

export interface KernelIpc {
  onMessage?(handler: (message: unknown) => void): void;
  /** Fork-IPC send back to the page (ADR-0045); absent when no IPC channel. */
  send?(message: unknown): void;
}

export function installRuntimeGlobals(): KernelIpc {
  const proc = globalThis.process as unknown as ProcStdio | undefined;
  const onMessage =
    typeof proc?.on === 'function'
      ? (handler: (message: unknown) => void) => {
          proc.on?.('message', handler);
        }
      : undefined;
  const send =
    typeof proc?.send === 'function'
      ? (message: unknown) => {
          proc.send?.(message);
        }
      : undefined;
  return { onMessage, send };
}
