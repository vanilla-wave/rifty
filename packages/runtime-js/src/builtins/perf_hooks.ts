/**
 * Node-compatible `node:perf_hooks` (subset).
 *
 * Routes `performance` to the browser/worker global and exposes a stub
 * PerformanceObserver that does nothing — Vite registers one to track
 * compile times but tolerates an inert implementation.
 */
import { NotImplementedError } from '@rifty/io';

class PerformanceObserver {
  // biome-ignore lint/correctness/noUnusedFunctionParameters: shape parity
  constructor(_callback: (list: unknown) => void) {}
  observe(_opts: { entryTypes?: string[]; type?: string; buffered?: boolean }): void {
    // no-op
  }
  disconnect(): void {
    // no-op
  }
  takeRecords(): unknown[] {
    return [];
  }
}

const perfHooks = {
  performance,
  PerformanceObserver,
  monitorEventLoopDelay(): never {
    throw new NotImplementedError('perf_hooks.monitorEventLoopDelay');
  },
  constants: {
    NODE_PERFORMANCE_GC_MAJOR: 4,
    NODE_PERFORMANCE_GC_MINOR: 1,
  },
};

export default perfHooks;
