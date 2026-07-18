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

  it('creates the runtime from that Workbench and coalesces later cleanup onto the runtime', async () => {
    const admittedClose = vi.fn(async (): Promise<void> => {});
    const admitted = workbench(admittedClose);
    const runtimeClose = vi.fn(async (): Promise<void> => {});
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
    expect(runtimeClose).toHaveBeenCalledTimes(1);
    expect(admittedClose).not.toHaveBeenCalled();
  });
});
