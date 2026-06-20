import { afterEach, describe, expect, it } from 'vitest';
import { activeRefs, resetKeepalive } from '../internal/event-loop-keepalive.ts';
import {
  timers,
  clearImmediate,
  installTimerGlobals,
  setImmediate,
  timersPromises,
} from './timers.ts';

afterEach(() => resetKeepalive());

describe('timers keepalive refcount', () => {
  it('setImmediate refs while pending and unrefs when cleared', () => {
    const h = setImmediate(() => {});
    expect(activeRefs()).toBe(1);
    clearImmediate(h);
    expect(activeRefs()).toBe(0);
  });

  it('setImmediate unrefs after it fires', async () => {
    await new Promise<void>((resolve) => {
      setImmediate(() => resolve());
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(activeRefs()).toBe(0);
  });

  it('global setTimeout handle unref/ref/hasRef controls the keepalive ref', () => {
    const original = {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      setInterval: globalThis.setInterval,
      clearInterval: globalThis.clearInterval,
    };
    try {
      installTimerGlobals();
      const handle = globalThis.setTimeout(() => {}, 1000) as unknown as {
        unref(): unknown;
        ref(): unknown;
        hasRef(): boolean;
      };

      expect(activeRefs()).toBe(1);
      expect(handle.hasRef()).toBe(true);
      expect(handle.unref()).toBe(handle);
      expect(activeRefs()).toBe(0);
      expect(handle.hasRef()).toBe(false);
      expect(handle.unref()).toBe(handle);
      expect(activeRefs()).toBe(0);
      expect(handle.ref()).toBe(handle);
      expect(activeRefs()).toBe(1);
      expect(handle.hasRef()).toBe(true);
      globalThis.clearTimeout(handle as never);
      expect(activeRefs()).toBe(0);
    } finally {
      globalThis.setTimeout = original.setTimeout;
      globalThis.clearTimeout = original.clearTimeout;
      globalThis.setInterval = original.setInterval;
      globalThis.clearInterval = original.clearInterval;
    }
  });

  it('global setInterval handle unref/ref/hasRef controls the keepalive ref', () => {
    const original = {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      setInterval: globalThis.setInterval,
      clearInterval: globalThis.clearInterval,
    };
    try {
      installTimerGlobals();
      const handle = globalThis.setInterval(() => {}, 1000) as unknown as {
        unref(): unknown;
        ref(): unknown;
        hasRef(): boolean;
      };

      expect(activeRefs()).toBe(1);
      expect(handle.unref()).toBe(handle);
      expect(activeRefs()).toBe(0);
      expect(handle.hasRef()).toBe(false);
      expect(handle.ref()).toBe(handle);
      expect(activeRefs()).toBe(1);
      expect(handle.hasRef()).toBe(true);
      globalThis.clearInterval(handle as never);
      expect(activeRefs()).toBe(0);
    } finally {
      globalThis.setTimeout = original.setTimeout;
      globalThis.clearTimeout = original.clearTimeout;
      globalThis.setInterval = original.setInterval;
      globalThis.clearInterval = original.clearInterval;
    }
  });

  it('node:timers setTimeout uses the keepalive wrapper, not the host timer', () => {
    const handle = timers.setTimeout(() => {}, 1000) as unknown as {
      unref(): unknown;
      ref(): unknown;
      hasRef(): boolean;
    };

    expect(activeRefs()).toBe(1);
    expect(handle.hasRef()).toBe(true);
    handle.unref();
    expect(activeRefs()).toBe(0);
    expect(handle.hasRef()).toBe(false);
    handle.ref();
    expect(activeRefs()).toBe(1);
    timers.clearTimeout(handle);
    expect(activeRefs()).toBe(0);
  });

  it('clearTimeout honors the numeric primitive id (Node accepts the coerced id)', () => {
    const handle = timers.setTimeout(() => {}, 1000);
    expect(activeRefs()).toBe(1);
    timers.clearTimeout(Number(handle));
    expect(activeRefs()).toBe(0);
  });

  it('clearInterval honors the numeric primitive id (clears + releases keepalive)', () => {
    const handle = timers.setInterval(() => {}, 1000);
    expect(activeRefs()).toBe(1);
    timers.clearInterval(Number(handle));
    expect(activeRefs()).toBe(0);
  });

  it('timers/promises setInterval honors {ref:false} (between-iterations timer uncounted)', () => {
    const ac = new AbortController();
    const iter = timersPromises.setInterval(1000, undefined, { ref: false, signal: ac.signal });
    const pending = iter.next();
    expect(activeRefs()).toBe(0);
    ac.abort();
    return pending.catch(() => {});
  });

  it('timers/promises setInterval is keepalive-counted by default', () => {
    const ac = new AbortController();
    const iter = timersPromises.setInterval(1000, undefined, { signal: ac.signal });
    const pending = iter.next();
    expect(activeRefs()).toBe(1);
    ac.abort();
    return pending.catch(() => {});
  });
});
