import { describe, expect, it, vi } from 'vitest';
import { rethrowAfterCleanup } from './cleanup-after-failure.ts';

describe('rethrowAfterCleanup', () => {
  it('runs cleanup once and preserves the triggering failure', async () => {
    const trigger = new Error('initialization failed');
    const cleanup = vi.fn(async (): Promise<void> => {});

    await expect(
      rethrowAfterCleanup('Playground App initialization', trigger, cleanup),
    ).rejects.toBe(trigger);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('preserves both the trigger and cleanup failure in causal order', async () => {
    const trigger = new Error('initialization failed');
    const cleanupFailure = new Error('Workbench close failed');
    const cleanup = vi.fn(async (): Promise<void> => {
      throw cleanupFailure;
    });

    const failure = await rethrowAfterCleanup(
      'Playground App initialization',
      trigger,
      cleanup,
    ).catch((error: unknown) => error);

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([trigger, cleanupFailure]);
  });
});
