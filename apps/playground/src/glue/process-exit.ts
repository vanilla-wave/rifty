import type { ProcessExit } from '@riftydev/shell';

/** One strict chokepoint for Node-style WorkerHandle exit events (ADR-0257). */
export function processExitFromChildEvent(code: unknown, signal: unknown): ProcessExit {
  if (typeof code === 'number' && Number.isSafeInteger(code) && code >= 0 && signal === null) {
    return { code, signal: null };
  }
  if (code === null && (signal === 'SIGINT' || signal === 'SIGTERM')) {
    return { code: null, signal };
  }
  throw new TypeError(`child emitted invalid exit (${String(code)}, ${String(signal)})`);
}
