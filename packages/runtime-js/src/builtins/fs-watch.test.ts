import { afterEach, describe, expect, it } from 'vitest';
import { activeRefs, resetKeepalive } from '../internal/event-loop-keepalive.ts';
import { FSWatcher } from './fs-watch.ts';
import { installTimerGlobals } from './timers.ts';

afterEach(() => resetKeepalive());

describe('FSWatcher ref/unref drive the keepalive refcount via the poll timer', () => {
  it('unref() opts the active watcher out of keepalive; ref() opts back in', () => {
    const original = {
      setInterval: globalThis.setInterval,
      clearInterval: globalThis.clearInterval,
    };
    try {
      installTimerGlobals();
      const watcher = new FSWatcher();
      watcher._start(() => {}, 1000);

      // The poll setInterval is keepalive-counted (an active watcher holds the realm).
      expect(activeRefs()).toBe(1);

      // unref() must release it (Node parity) — not a no-op stub that lies.
      expect(watcher.unref()).toBe(watcher);
      expect(activeRefs()).toBe(0);

      expect(watcher.ref()).toBe(watcher);
      expect(activeRefs()).toBe(1);

      watcher.close();
      expect(activeRefs()).toBe(0);
    } finally {
      globalThis.setInterval = original.setInterval;
      globalThis.clearInterval = original.clearInterval;
    }
  });
});
