import { describe, expect, it } from 'vitest';
import { probeStoragePersistence } from './storage-status.ts';

describe('probeStoragePersistence', () => {
  it('requests persistence and returns quota details', async () => {
    const status = await probeStoragePersistence({
      storage: {
        persisted: async () => false,
        persist: async () => true,
        estimate: async () => ({ usage: 10, quota: 100 }),
      },
    });

    expect(status).toEqual({
      available: true,
      persistedBefore: false,
      persistedAfter: true,
      usage: 10,
      quota: 100,
    });
  });

  it('does not request persistence when already persisted', async () => {
    let persistCalled = false;
    const status = await probeStoragePersistence({
      storage: {
        persisted: async () => true,
        persist: async () => {
          persistCalled = true;
          return true;
        },
        estimate: async () => ({ usage: 4 }),
      },
    });

    expect(persistCalled).toBe(false);
    expect(status.available).toBe(true);
    if (!status.available) throw new Error('storage status should be available');
    expect(status.persistedBefore).toBe(true);
    expect(status.persistedAfter).toBe(true);
    expect(status.usage).toBe(4);
    expect(status.quota).toBeUndefined();
  });

  it('returns an unavailable status when navigator.storage is absent', async () => {
    await expect(probeStoragePersistence({})).resolves.toEqual({ available: false });
  });
});
