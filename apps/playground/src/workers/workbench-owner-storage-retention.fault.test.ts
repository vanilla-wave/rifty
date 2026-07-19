import { describe, expect, it, vi } from 'vitest';
import { probeWorkbenchOwnerStorageRetention } from './workbench-owner-storage-retention.ts';

describe('false-fallback: Workbench owner storage retention', () => {
  it('reports unavailable when persisted() throws and does not request a grant', async () => {
    const persist = vi.fn(async () => true);

    const retention = await probeWorkbenchOwnerStorageRetention({
      persisted: () => {
        throw new Error('persisted failed');
      },
      persist,
    });

    expect(retention).toEqual({ available: false });
    expect(Reflect.ownKeys(retention)).toEqual(['available']);
    expect(Object.isFrozen(retention)).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it('reports unavailable when persist() rejects a new grant request', async () => {
    const persist = vi.fn(async () => {
      throw new Error('persist failed');
    });

    const retention = await probeWorkbenchOwnerStorageRetention({
      persisted: async () => false,
      persist,
    });

    expect(retention).toEqual({ available: false });
    expect(Reflect.ownKeys(retention)).toEqual(['available']);
    expect(Object.isFrozen(retention)).toBe(true);
    expect(persist).toHaveBeenCalledTimes(1);
  });
});
