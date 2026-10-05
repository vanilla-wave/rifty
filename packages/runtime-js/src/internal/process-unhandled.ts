import { readActiveNodeProcessBootstrap } from '../builtins/process-bootstrap-identity.ts';

interface ProcessEvents {
  listenerCount(event: string): number;
  emit(event: string, ...args: unknown[]): boolean;
}

/** Only the runtime-owned process receives browser-realm failures. */
export function dispatchProcessUnhandled(
  reason: unknown,
  origin: 'uncaught-error' | 'rejection' | 'entry-esm',
  promise?: unknown,
): boolean {
  const proc = readActiveNodeProcessBootstrap()?.process as Partial<ProcessEvents> | undefined;
  if (typeof proc?.listenerCount !== 'function' || typeof proc.emit !== 'function') return false;
  if (origin === 'rejection' && proc.listenerCount('unhandledRejection') > 0) {
    return proc.emit('unhandledRejection', reason, promise);
  }
  if (proc.listenerCount('uncaughtException') > 0) {
    return proc.emit(
      'uncaughtException',
      reason,
      origin === 'uncaught-error' ? 'uncaughtException' : 'unhandledRejection',
    );
  }
  return false;
}
