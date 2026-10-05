/**
 * Process-lifecycle dispatcher (process-lifecycle-events-exit-code): the
 * keepalive traps consult the ACTIVE runtime-owned NodeProcess FIRST —
 * `uncaughtException`/`unhandledRejection` listeners take the error and the
 * loop continues, as in Node; with no listener the loud ADR-0152 path stands.
 * Lives beside NodeProcess (late binding; process.ts already imports the
 * keepalive — the reverse import would cross layers).
 */
import { setProcessLifecycleDispatcher } from '../internal/event-loop-keepalive.ts';
import { readActiveNodeProcessBootstrap } from './process-bootstrap-identity.ts';

/** Exit-event state; per-process, kept off the class body. */
const EXIT_EMITTED = new WeakSet<object>();

export function emitProcessExitEvent(proc: object, code: number): void {
  if (EXIT_EMITTED.has(proc)) return;
  EXIT_EMITTED.add(proc);
  (proc as { emit(event: 'exit', code: number): boolean }).emit('exit', code);
}

function activeLifecycleProcess(): object | null {
  const active = readActiveNodeProcessBootstrap()?.process;
  if (active !== undefined && active !== null) return active;
  const global = (globalThis as { process?: unknown }).process;
  return global ?? null;
}

export function installProcessLifecycleDispatcher(
  isNodeProcess: (value: unknown) => boolean,
): void {
  setProcessLifecycleDispatcher({
    dispatchUnhandled(reason, origin) {
      const active = activeLifecycleProcess();
      if (!isNodeProcess(active)) return { handled: false };
      const proc = active as unknown as {
        emit(event: string, ...args: unknown[]): unknown;
        listenerCount(event: string): number;
      };
      const emitFor = (event: 'uncaughtException' | 'unhandledRejection'): unknown => {
        try {
          if (event === 'unhandledRejection') proc.emit(event, reason, undefined);
          else proc.emit(event, reason);
          return null;
        } catch (replacement) {
          // Node: an exception inside a handler is fatal with the NEW error.
          return replacement;
        }
      };
      if (proc.listenerCount('uncaughtException') > 0) {
        // Node default (--unhandled-rejections=throw): a rejection with no
        // dedicated handler falls to uncaughtException.
        const direct =
          origin === 'uncaught-error' || proc.listenerCount('unhandledRejection') === 0;
        if (direct) {
          const thrown = emitFor('uncaughtException');
          return thrown === null ? { handled: true } : { handled: false, replacement: thrown };
        }
      }
      if (proc.listenerCount('unhandledRejection') > 0) {
        const thrown = emitFor('unhandledRejection');
        return thrown === null ? { handled: true } : { handled: false, replacement: thrown };
      }
      return { handled: false };
    },
    emitNaturalExit() {
      const active = activeLifecycleProcess();
      if (active !== null && isNodeProcess(active)) {
        emitProcessExitEvent(active, (active as { exitCode: number }).exitCode);
      }
    },
  });
}
