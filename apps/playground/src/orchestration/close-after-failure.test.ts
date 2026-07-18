import { describe, expect, it, vi } from 'vitest';
import { closeAfterFailure } from './close-after-failure.ts';

describe('closeAfterFailure', () => {
  it('closes the admitted resource once and preserves the triggering failure', async () => {
    const trigger = new Error('initialization failed');
    const resource = Object.freeze({ close: vi.fn(async (): Promise<void> => {}) });

    await expect(
      closeAfterFailure('Playground App initialization', resource, trigger),
    ).rejects.toBe(trigger);
    expect(resource.close).toHaveBeenCalledTimes(1);
  });

  it('preserves both the trigger and cleanup failure in causal order', async () => {
    const trigger = new Error('initialization failed');
    const cleanup = new Error('Workbench close failed');
    const resource = Object.freeze({
      close: vi.fn(async (): Promise<void> => {
        throw cleanup;
      }),
    });

    const failure = await closeAfterFailure(
      'Playground App initialization',
      resource,
      trigger,
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([trigger, cleanup]);
  });
});
