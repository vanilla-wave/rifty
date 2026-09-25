import { captureEventEmitterListenerScope } from '@riftydev/io';
import { riftyProcess } from '@riftydev/runtime-js/builtins/process';
import { captureTimerBoundary, clearTimersSince } from '@riftydev/runtime-js/internal';

/**
 * One Node process run in place in the reused no-COI realm (project command,
 * runBin). Its terminal ends it (ADR-0445): none of its timers (an `'exit'`
 * listener's, an unref'd one) or process/stdio listeners runs afterwards.
 * Open before guest code.
 */
export interface NoCoiInvocationScope {
  clearTimers(): void;
  end(): void;
}

export function openNoCoiInvocationScope(): NoCoiInvocationScope {
  const timerBoundary = captureTimerBoundary();
  const listenerScopes = [
    riftyProcess,
    riftyProcess.stdin,
    riftyProcess.stdout,
    riftyProcess.stderr,
  ].map(captureEventEmitterListenerScope);
  return {
    clearTimers: () => clearTimersSince(timerBoundary),
    end() {
      for (const retire of listenerScopes) retire();
      clearTimersSince(timerBoundary);
    },
  };
}
