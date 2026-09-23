import { readActiveNodeProcessBootstrap } from './process-bootstrap-identity.ts';

export const NODE_PROCESS_EXIT_EVENT = Symbol.for('rifty.runtime-js.process-exit-event.v1');

interface ErrorProcess {
  emit(event: string, ...args: unknown[]): boolean;
  stderr: { write(message: string): unknown };
  exit(code: number): never;
  [NODE_PROCESS_EXIT_EVENT](code: number, emit: boolean): void;
}

export function notifyProcessExit(code: number, emit = true): void {
  const process = readActiveNodeProcessBootstrap()?.process as ErrorProcess | undefined;
  process?.[NODE_PROCESS_EXIT_EVENT](code, emit);
}

export function isProcessExitSignal(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'RIFTY_PROCESS_EXIT'
  );
}

/** ADR-0445: handled errors never enter the fatal drain/terminal owner. */
export function dispatchProcessError(
  reason: unknown,
  origin: 'uncaughtException' | 'unhandledRejection',
  promise?: unknown,
): boolean {
  if (isProcessExitSignal(reason)) return false;
  const process = readActiveNodeProcessBootstrap()?.process as ErrorProcess | undefined;
  if (!process) return false;
  if (origin === 'unhandledRejection') {
    try {
      if (process.emit('unhandledRejection', reason, promise)) return true;
    } catch (error) {
      if (isProcessExitSignal(error)) throw error;
      return emitUncaught(process, error, 'uncaughtException');
    }
  }
  return emitUncaught(process, reason, origin);
}

function emitUncaught(process: ErrorProcess, reason: unknown, origin: string): boolean {
  try {
    return process.emit('uncaughtException', reason, origin);
  } catch (error) {
    if (isProcessExitSignal(error)) throw error;
    notifyProcessExit(7, false);
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exit(7);
  }
}
