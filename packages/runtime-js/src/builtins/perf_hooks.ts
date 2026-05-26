/**
 * Node-compatible `node:perf_hooks` (subset).
 *
 * Routes `performance` to the browser/worker global and exposes a stub
 * `PerformanceObserver` that follows ADR-0010's pattern (also used for
 * `node:https`): import-time construction is harmless (tools like Vite
 * register an observer defensively even when they may never use it), but
 * any real attempt to *use* the observation channel throws
 * `NotImplementedError` so the gap stays loud (CLAUDE.md "no silent stubs").
 * `disconnect()` / `takeRecords()` stay no-op / empty — they're inert if
 * `observe()` was never called, and they would themselves be silent stubs
 * if reachable past a thrown `observe()`.
 */
import { NotImplementedError } from '@rifty/io';

class PerformanceObserver {
  constructor(_callback: (list: unknown) => void) {
    // Constructor is intentionally callable so defensive top-level
    // `new PerformanceObserver(...)` (Vite, etc.) doesn't blow up at import.
  }
  observe(_opts: { entryTypes?: string[]; type?: string; buffered?: boolean }): void {
    throw new NotImplementedError('perf_hooks.PerformanceObserver.observe');
  }
  disconnect(): void {
    // Harmless no-op: only reachable if `observe()` threw and the caller
    // still ran cleanup, or if it was never called at all.
  }
  takeRecords(): unknown[] {
    // Returns the empty list because no records can have accumulated:
    // `observe()` always throws before any entry is buffered.
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
