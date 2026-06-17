// apps/playground/src/workers/worker-runtime-globals.ts
/**
 * Shared worker-realm runtime-globals install (extracted from real-vite-bootstrap
 * so the dev-server child bootstrap can reuse it without importing the owner
 * entry module). Preserves kernel pre-entry stdio + env + fork-IPC across the
 * installProcessGlobals() swap — else all worker logs (boot progress AND error
 * stacks) vanish into the worker devtools console and a stalled boot looks frozen.
 */
import { Buffer } from '@riftydev/runtime-js/builtins/buffer';
import { installProcessGlobals } from '@riftydev/runtime-js/builtins/process';
import { installTimerGlobals } from '@riftydev/runtime-js/builtins/timers';

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
  // Gotcha: the kernel pre-entry hook's `process` posts stdout/stderr to the
  // page over MessagePorts (the only reason the terminal sees worker output).
  // `installProcessGlobals` swaps in runtime-js's richer shim, but its stdout/
  // stderr default to `console.*` (worker console, NOT page terminal) and env
  // is empty — clobbering the wiring made all worker logs (boot progress AND
  // error stacks) vanish, so a stalled boot looked frozen. Preserve kernel
  // stdio + env across the swap.
  const prev = globalThis.process as unknown as ProcStdio | undefined;
  const kStdout = prev?.stdout;
  const kStderr = prev?.stderr;
  const kEnv = prev?.env;
  const kOnMessage =
    typeof prev?.on === 'function'
      ? (handler: (message: unknown) => void) => {
          prev.on?.('message', handler);
        }
      : undefined;
  // The fork-IPC `send` lives on the kernel pre-entry process shim; the
  // installProcessGlobals swap below drops it, so capture it (bound) BEFORE the
  // swap — the pty server posts owner→page frames through it (ADR-0146).
  const kSend =
    typeof prev?.send === 'function'
      ? (message: unknown) => {
          prev.send?.(message);
        }
      : undefined;
  installProcessGlobals();
  installTimerGlobals();
  (globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
  const proc = globalThis.process as unknown as ProcStdio;
  if (kStdout && typeof kStdout.write === 'function') proc.stdout = kStdout;
  if (kStderr && typeof kStderr.write === 'function') proc.stderr = kStderr;
  if (kEnv) proc.env = kEnv;
  return { onMessage: kOnMessage, send: kSend };
}
