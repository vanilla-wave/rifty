/**
 * Unit tests for the `node:perf_hooks` stub. Mirrors ADR-0010's
 * "import-time OK, use-time loud" pattern: tools like Vite construct a
 * `PerformanceObserver` defensively at module-load time to track compile
 * timings, so the constructor must not throw. The *actual observation* is
 * the unimplemented feature — `observe(...)` must throw `NotImplementedError`
 * so any code that genuinely depends on the observation channel fails loudly
 * (CLAUDE.md "no silent stubs").
 */
import { NotImplementedError } from '@rifty/io';
import { describe, expect, it } from 'vitest';
import perfHooks from './perf_hooks.ts';

describe('perf_hooks.PerformanceObserver', () => {
  it('constructor is callable (import-time defensive construction must not throw)', () => {
    expect(() => new perfHooks.PerformanceObserver(() => {})).not.toThrow();
  });

  it('observe() throws NotImplementedError with the documented feature key', () => {
    const obs = new perfHooks.PerformanceObserver(() => {});
    expect(() => obs.observe({ entryTypes: ['measure'] })).toThrow(NotImplementedError);
    expect(() => obs.observe({ entryTypes: ['measure'] })).toThrow(
      /perf_hooks\.PerformanceObserver\.observe/,
    );
  });
});
