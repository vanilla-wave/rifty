import { describe, expect, it, vi } from 'vitest';
import { probeWorkbenchOwnerStorageRetention } from './workbench-owner-storage-retention.ts';

describe('Workbench owner storage retention', () => {
  it('reports the exact unavailable value when storage is absent', async () => {
    const retention = await probeWorkbenchOwnerStorageRetention(undefined);

    expect(retention).toEqual({ available: false });
    expect(Reflect.ownKeys(retention)).toEqual(['available']);
    expect(Object.isFrozen(retention)).toBe(true);
  });

  it('keeps an existing persistent grant without requesting it again', async () => {
    const persist = vi.fn(async () => false);

    const retention = await probeWorkbenchOwnerStorageRetention({
      persisted: async () => true,
      persist,
    });

    expect(retention).toEqual({ available: true, persistedAfter: true });
    expect(Reflect.ownKeys(retention)).toEqual(['available', 'persistedAfter']);
    expect(Object.isFrozen(retention)).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it.each([
    ['grant', true],
    ['denial', false],
  ] as const)('reports the exact persistence %s', async (_label, persistedAfter) => {
    const persisted = vi.fn(async () => false);
    const persist = vi.fn(async () => persistedAfter);

    const retention = await probeWorkbenchOwnerStorageRetention({ persisted, persist });

    expect(retention).toEqual({ available: true, persistedAfter });
    expect(Reflect.ownKeys(retention)).toEqual(['available', 'persistedAfter']);
    expect(Object.isFrozen(retention)).toBe(true);
    expect(persisted).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledTimes(1);
  });
});
