import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withSlowProgress } from './slow-progress.ts';

describe('withSlowProgress', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes through a fast resolution without ever signaling slow', async () => {
    const onSlow = vi.fn();
    const result = withSlowProgress(Promise.resolve('ok'), { delayMs: 250, onSlow });
    await expect(result).resolves.toBe('ok');
    vi.advanceTimersByTime(1000);
    expect(onSlow).not.toHaveBeenCalled();
  });

  it('signals slow once after the delay and reports total elapsed on success', async () => {
    const onSlow = vi.fn();
    const onSettledAfterSlow = vi.fn();
    let resolve!: (v: string) => void;
    const work = new Promise<string>((r) => {
      resolve = r;
    });
    const result = withSlowProgress(work, { delayMs: 250, onSlow, onSettledAfterSlow });
    await vi.advanceTimersByTimeAsync(9_000);
    expect(onSlow).toHaveBeenCalledTimes(1);
    resolve('done');
    await expect(result).resolves.toBe('done');
    expect(onSettledAfterSlow).toHaveBeenCalledTimes(1);
    expect(onSettledAfterSlow.mock.calls[0]?.[0]).toBeGreaterThanOrEqual(9_000);
  });

  it('a failure after the slow signal propagates and never claims completion', async () => {
    const onSlow = vi.fn();
    const onSettledAfterSlow = vi.fn();
    let reject!: (e: Error) => void;
    const work = new Promise<string>((_r, rj) => {
      reject = rj;
    });
    const result = withSlowProgress(work, { delayMs: 250, onSlow, onSettledAfterSlow });
    await vi.advanceTimersByTimeAsync(500);
    reject(new Error('boom'));
    await expect(result).rejects.toThrow('boom');
    expect(onSlow).toHaveBeenCalledTimes(1);
    expect(onSettledAfterSlow).not.toHaveBeenCalled();
  });

  it('a fast failure propagates without signaling slow', async () => {
    const onSlow = vi.fn();
    const result = withSlowProgress(Promise.reject(new Error('nope')), { delayMs: 250, onSlow });
    await expect(result).rejects.toThrow('nope');
    vi.advanceTimersByTime(1000);
    expect(onSlow).not.toHaveBeenCalled();
  });
});
