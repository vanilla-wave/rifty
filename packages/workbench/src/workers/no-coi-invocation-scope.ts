import { captureEventEmitterListenerScope } from '@riftydev/io';
import { globalProcessManager } from '@riftydev/kernel';
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
  const priorChildren = new Set(globalProcessManager.snapshot().map((process) => process.pid));
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
      for (const child of globalProcessManager.snapshot()) {
        if (child.ppid === riftyProcess.pid && !priorChildren.has(child.pid))
          globalProcessManager.kill(child.pid);
      }
      clearTimersSince(timerBoundary);
    },
  };
}
