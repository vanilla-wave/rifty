import { describe, expect, it, vi } from 'vitest';
import type { PlaygroundWorkbench } from '../workbench/playground.ts';
import type { PlaygroundAppRuntime } from './playground-app-runtime.ts';
import { createPlaygroundAppWorkbenchOwnership } from './playground-app-workbench-ownership.ts';

function workbench(close = vi.fn(async (): Promise<void> => {})): PlaygroundWorkbench {
  return Object.freeze({ close }) as unknown as PlaygroundWorkbench;
}

function runtime(close = vi.fn(async (): Promise<void> => {})): PlaygroundAppRuntime {
  return Object.freeze({ close }) as unknown as PlaygroundAppRuntime;
}

describe('Playground App admitted Workbench ownership', () => {
  it('closes the exact admitted Workbench once when initialization fails before runtime', async () => {
    const close = vi.fn(async (): Promise<void> => {});
    const admitted = workbench(close);
    const ownership = createPlaygroundAppWorkbenchOwnership(admitted);
    const trigger = new Error('terminal restore failed');

    await expect(ownership.fail(trigger)).rejects.toBe(trigger);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('aggregates a pre-runtime trigger with failure to close the admitted Workbench', async () => {
    const cleanup = new Error('Workbench close failed');
    const admitted = workbench(
      vi.fn(async (): Promise<void> => {
        throw cleanup;
      }),
    );
    const ownership = createPlaygroundAppWorkbenchOwnership(admitted);
    const trigger = new Error('terminal restore failed');

    const failure = await ownership.fail(trigger).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([trigger, cleanup]);
  });

  it('creates the runtime from that Workbench and delegates repeated cleanup to it', async () => {
    const admittedClose = vi.fn(async (): Promise<void> => {});
    const admitted = workbench(admittedClose);
    const closing = Promise.resolve();
    const runtimeClose = vi.fn(() => closing);
    const created = runtime(runtimeClose);
    const createRuntime = vi.fn((received: PlaygroundWorkbench) => {
      expect(received).toBe(admitted);
      return created;
    });
    const ownership = createPlaygroundAppWorkbenchOwnership(admitted);

    expect(ownership.createRuntime(createRuntime)).toBe(created);
    const first = ownership.close();
    const second = ownership.close();

    expect(second).toBe(first);
    await first;
    expect(createRuntime).toHaveBeenCalledTimes(1);
    expect(runtimeClose).toHaveBeenCalledTimes(2);
    expect(admittedClose).not.toHaveBeenCalled();
  });

  it.each(['admitted Workbench', 'App runtime'] as const)(
    'delegates a retry after rejected close to the current %s',
    async (owner) => {
      const retryable = new Error('retryable close preflight');
      const resourceClose = vi
        .fn<() => Promise<void>>()
        .mockRejectedValueOnce(retryable)
        .mockResolvedValueOnce(undefined);
      const admittedClose = owner === 'admitted Workbench' ? resourceClose : vi.fn(async () => {});
      const admitted = workbench(admittedClose);
      const ownership = createPlaygroundAppWorkbenchOwnership(admitted);

      if (owner === 'App runtime') {
        ownership.createRuntime(() => runtime(resourceClose));
      }

      await expect(ownership.close()).rejects.toBe(retryable);
      await expect(ownership.close()).resolves.toBeUndefined();
      expect(resourceClose).toHaveBeenCalledTimes(2);
      if (owner === 'App runtime') expect(admittedClose).not.toHaveBeenCalled();
    },
  );
});
