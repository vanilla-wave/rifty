import { afterEach, describe, expect, it } from 'vitest';
import { activeRefs, resetKeepalive } from '../internal/event-loop-keepalive.ts';
import { clearImmediate, setImmediate } from './timers.ts';

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
});
