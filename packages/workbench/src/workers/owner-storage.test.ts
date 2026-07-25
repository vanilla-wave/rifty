import { describe, expect, it, vi } from 'vitest';
import { type OwnerStorageInstallers, selectOwnerStorage } from './owner-storage.ts';

interface OpfsBackend {
  readonly kind: 'opfs';
}

function harness() {
  const backend = Object.freeze({ kind: 'opfs' as const });
  const openOpfs = vi.fn(async (): Promise<OpfsBackend> => backend);
  const proveOpfs = vi.fn(async (_backend: OpfsBackend): Promise<void> => {});
  const openMemory = vi.fn(async (): Promise<void> => {});
  const installers: OwnerStorageInstallers<OpfsBackend> = {
    openOpfs,
    proveOpfs,
    openMemory,
  };
  return { backend, installers, openMemory, openOpfs, proveOpfs };
}

describe('owner-authoritative storage selection', () => {
  // Fault class: provenance-lie. The returned snapshot is born beside the
  // actual installer calls, so the page cannot report a predicted backend.
  it.each(['required', 'preferred'] as const)(
    '%s reports durable OPFS only after opening and proving that exact backend',
    async (policy) => {
      const h = harness();

      const snapshot = await selectOwnerStorage(policy, h.installers);

      expect(h.openOpfs).toHaveBeenCalledTimes(1);
      expect(h.proveOpfs).toHaveBeenCalledTimes(1);
      expect(h.proveOpfs).toHaveBeenCalledWith(h.backend);
      expect(h.openMemory).not.toHaveBeenCalled();
      expect(snapshot).toEqual({ policy, backend: 'opfs', durability: 'durable' });
      expect(Object.isFrozen(snapshot)).toBe(true);
    },
  );

  // Fault class: false-fallback. Required storage has no memory sibling.
  it('required preserves the exact OPFS-open failure and never opens or proves memory', async () => {
    const h = harness();
    const failure = new Error('OPFS permission denied');
    h.openOpfs.mockRejectedValueOnce(failure);

    await expect(selectOwnerStorage('required', h.installers)).rejects.toBe(failure);

    expect(h.proveOpfs).not.toHaveBeenCalled();
    expect(h.openMemory).not.toHaveBeenCalled();
  });

  it('required preserves the exact OPFS-proof failure and never falls back to memory', async () => {
    const h = harness();
    const failure = new Error('OPFS durability proof failed');
    h.proveOpfs.mockRejectedValueOnce(failure);

    await expect(selectOwnerStorage('required', h.installers)).rejects.toBe(failure);

    expect(h.openOpfs).toHaveBeenCalledTimes(1);
    expect(h.proveOpfs).toHaveBeenCalledWith(h.backend);
    expect(h.openMemory).not.toHaveBeenCalled();
  });

  it.each([
    {
      boundary: 'open',
      fail(h: ReturnType<typeof harness>, failure: Error) {
        h.openOpfs.mockRejectedValueOnce(failure);
      },
      proofCalls: 0,
    },
    {
      boundary: 'proof',
      fail(h: ReturnType<typeof harness>, failure: Error) {
        h.proveOpfs.mockRejectedValueOnce(failure);
      },
      proofCalls: 1,
    },
  ] as const)(
    'preferred visibly falls back to memory with the exact OPFS-$boundary reason',
    async ({ boundary, fail, proofCalls }) => {
      const h = harness();
      const failure = new Error(`OPFS ${boundary} failed exactly`);
      fail(h, failure);

      const snapshot = await selectOwnerStorage('preferred', h.installers);

      expect(h.openOpfs).toHaveBeenCalledTimes(1);
      expect(h.proveOpfs).toHaveBeenCalledTimes(proofCalls);
      expect(h.openMemory).toHaveBeenCalledTimes(1);
      expect(snapshot).toEqual({
        policy: 'preferred',
        backend: 'memory',
        durability: 'ephemeral',
        fallback: { reason: failure.message },
      });
      expect(Object.isFrozen(snapshot)).toBe(true);
      if (snapshot.policy !== 'preferred' || snapshot.backend !== 'memory') {
        throw new Error('preferred fallback must report its owner-born reason');
      }
      expect(Object.isFrozen(snapshot.fallback)).toBe(true);
    },
  );

  it.each([
    {
      boundary: 'open',
      fail(h: ReturnType<typeof harness>, failure: Error) {
        h.openOpfs.mockRejectedValueOnce(failure);
      },
    },
    {
      boundary: 'proof',
      fail(h: ReturnType<typeof harness>, failure: Error) {
        h.proveOpfs.mockRejectedValueOnce(failure);
      },
    },
  ] as const)(
    'preferred preserves OPFS-$boundary then memory failures in causal order',
    async ({ boundary, fail }) => {
      const h = harness();
      const opfsFailure = new Error(`OPFS ${boundary} failed`);
      const memoryFailure = new Error('memory installation failed');
      fail(h, opfsFailure);
      h.openMemory.mockRejectedValueOnce(memoryFailure);

      const error = await selectOwnerStorage('preferred', h.installers).catch(
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toEqual([opfsFailure, memoryFailure]);
      expect((error as AggregateError).message).toBe(
        `Preferred storage failed: ${opfsFailure.message}; ${memoryFailure.message}`,
      );
    },
  );

  it('ephemeral installs memory directly and performs zero OPFS effects', async () => {
    const h = harness();

    const snapshot = await selectOwnerStorage('ephemeral', h.installers);

    expect(h.openMemory).toHaveBeenCalledTimes(1);
    expect(h.openOpfs).not.toHaveBeenCalled();
    expect(h.proveOpfs).not.toHaveBeenCalled();
    expect(snapshot).toEqual({
      policy: 'ephemeral',
      backend: 'memory',
      durability: 'ephemeral',
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it('ephemeral preserves its exact memory installation failure without touching OPFS', async () => {
    const h = harness();
    const failure = new Error('ephemeral memory installation failed');
    h.openMemory.mockRejectedValueOnce(failure);

    await expect(selectOwnerStorage('ephemeral', h.installers)).rejects.toBe(failure);

    expect(h.openOpfs).not.toHaveBeenCalled();
    expect(h.proveOpfs).not.toHaveBeenCalled();
  });
});
