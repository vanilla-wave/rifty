import { describe, expect, it, vi } from 'vitest';
import { withMeasuredBrowser } from './browser-lifecycle.mjs';

describe('measured browser lifecycle', () => {
  it('does not return a measurement until Chromium closes successfully', async () => {
    let releaseClose: (() => void) | undefined;
    const close = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseClose = resolve;
        }),
    );
    const settled = vi.fn();
    const operation = withMeasuredBrowser(
      async () => ({ close }),
      async () => 'measured',
    ).then(settled);

    await Promise.resolve();
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    releaseClose?.();
    await expect(operation).resolves.toBe('measured');
    expect(close).toHaveBeenCalledOnce();
  });

  it('refuses a measurement when Chromium close fails', async () => {
    const closeFailure = new Error('Chromium close failed');

    await expect(
      withMeasuredBrowser(
        async () => ({ close: async () => Promise.reject(closeFailure) }),
        async () => 'measured',
      ),
    ).rejects.toBe(closeFailure);
  });

  it('preserves both the measurement and close failures', async () => {
    const measurementFailure = new Error('measurement failed');
    const closeFailure = new Error('Chromium close failed');

    const failure = await withMeasuredBrowser(
      async () => ({ close: async () => Promise.reject(closeFailure) }),
      async () => Promise.reject(measurementFailure),
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([measurementFailure, closeFailure]);
  });

  it('does not attempt close when Chromium launch itself fails', async () => {
    const launchFailure = new Error('launch failed');
    const run = vi.fn();

    await expect(
      withMeasuredBrowser(
        async () => Promise.reject(launchFailure),
        run,
      ),
    ).rejects.toBe(launchFailure);
    expect(run).not.toHaveBeenCalled();
  });
});
