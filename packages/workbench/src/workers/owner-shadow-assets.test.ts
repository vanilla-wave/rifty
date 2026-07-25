import { RegistryClient } from '@riftydev/npm-client';
import { planAppliedShadowSubstitutions } from '@riftydev/npm-client/internal';
import { MemoryVfs } from '@riftydev/vfs';
import { createMemoryFs, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SyncMirrorVfs } from '../glue/sync-mirror-vfs.ts';
import { createOwnerShadowAssetAuthority } from './owner-shadow-assets.ts';
import type { OwnerStorageSnapshot } from './owner-storage.ts';
import { createOwnerVfsAuthorityComposition } from './owner-vfs-authority.ts';

const registry = new RegistryClient({
  baseUrl: 'https://example.test/registry',
  fetch: async () => new Response('', { status: 599 }),
});

const OPFS: OwnerStorageSnapshot = Object.freeze({
  policy: 'preferred',
  backend: 'opfs',
  durability: 'durable',
});
const MEMORY: OwnerStorageSnapshot = Object.freeze({
  policy: 'ephemeral',
  backend: 'memory',
  durability: 'ephemeral',
});

afterEach(resetSyncMirror);

function ownerOpfsHarness(fault: 'none' | 'quota' | 'torn-ready') {
  const pair = createMemoryFs();
  const persistedVfs = new MemoryVfs();
  let flushCalls = 0;
  const fsSync = Object.assign(pair.fsSync, {
    async flush() {
      flushCalls += 1;
      if (fault === 'quota') throw new Error('QuotaExceededError');
      // Empty plan writes receipt, then ready. Preserve the first durable receipt
      // but deliberately omit the second flush to model a torn ready pointer.
      if (fault === 'torn-ready' && flushCalls === 2) {
        return { failures: [], total: 0 };
      }
      const root = '/.rifty/shadow-assets/v1';
      await persistedVfs.rm(root, { recursive: true, force: true });
      const entries = authority
        .snapshot()
        .entries.filter((entry) => entry.path === root || entry.path.startsWith(`${root}/`));
      for (const entry of entries.filter((candidate) => candidate.kind === 'dir')) {
        await persistedVfs.mkdir(entry.path, { recursive: true });
      }
      for (const entry of entries.filter((candidate) => candidate.kind === 'file')) {
        const parent = entry.path.slice(0, entry.path.lastIndexOf('/')) || '/';
        await persistedVfs.mkdir(parent, { recursive: true });
        await persistedVfs.writeFile(entry.path, entry.content);
      }
      return { failures: [], total: 0 };
    },
  });
  const authority = createOwnerVfsAuthorityComposition(fsSync, {
    ownerEpoch: `shadow-${fault}`,
    initialRoots: ['/'],
  }).authority;
  setSyncMirror(authority, { async: pair.vfs });
  return {
    authority,
    mutationVfs: new SyncMirrorVfs(),
    persistedVfs,
    flushCalls: () => flushCalls,
  };
}

describe('owner shadow asset storage classification', () => {
  it.each([
    {
      name: 'already persisted OPFS',
      ownerStorage: OPFS,
      storageManager: {
        persisted: vi.fn(async () => true),
        persist: vi.fn(async () => false),
      },
      expected: 'opfs-persisted',
    },
    {
      name: 'best-effort OPFS',
      ownerStorage: OPFS,
      storageManager: {
        persisted: vi.fn(async () => false),
        persist: vi.fn(async () => false),
      },
      expected: 'opfs-best-effort',
    },
    {
      name: 'newly persisted OPFS',
      ownerStorage: OPFS,
      storageManager: {
        persisted: vi.fn(async () => false),
        persist: vi.fn(async () => true),
      },
      expected: 'opfs-persisted',
    },
    {
      name: 'OPFS without persistence API',
      ownerStorage: OPFS,
      storageManager: undefined,
      expected: 'opfs-best-effort',
    },
    {
      name: 'OPFS when persisted probe throws',
      ownerStorage: OPFS,
      storageManager: {
        persisted: vi.fn(async () => {
          throw new Error('persisted unavailable');
        }),
        persist: vi.fn(async () => false),
      },
      expected: 'opfs-best-effort',
    },
    {
      name: 'OPFS when persist request throws',
      ownerStorage: OPFS,
      storageManager: {
        persisted: vi.fn(async () => false),
        persist: vi.fn(async () => {
          throw new Error('persist unavailable');
        }),
      },
      expected: 'opfs-best-effort',
    },
    {
      name: 'memory owner',
      ownerStorage: MEMORY,
      storageManager: {
        persisted: vi.fn(async () => true),
        persist: vi.fn(async () => true),
      },
      expected: 'memory-session',
    },
  ] as const)('reports $name without relabelling its adapter', async (testCase) => {
    const vfs = new MemoryVfs();
    const authority = await createOwnerShadowAssetAuthority({
      ownerStorage: testCase.ownerStorage,
      vfs,
      registry,
      ...(testCase.storageManager === undefined
        ? { storageManager: undefined }
        : { storageManager: testCase.storageManager }),
      ...(testCase.ownerStorage.backend === 'opfs'
        ? {
            durability: {
              persistedVfs: vfs,
              flush: async () => ({ failures: [], total: 0 }),
            },
          }
        : {}),
    });
    const ready = await authority.manager.ensure(planAppliedShadowSubstitutions([]));

    expect(authority.storageClass).toBe(testCase.expected);
    expect(ready.receipt.storageClass).toBe(testCase.expected);
    await authority.manager.close();
  });

  it('writes through SyncMirrorVfs, flushes its owner authority, and reads actual persisted bytes', async () => {
    const h = ownerOpfsHarness('none');
    const authority = await createOwnerShadowAssetAuthority({
      ownerStorage: OPFS,
      vfs: h.mutationVfs,
      registry,
      storageManager: {
        persisted: async () => true,
        persist: async () => true,
      },
      durability: {
        persistedVfs: h.persistedVfs,
        flush: async () => {
          const report = await h.authority.flush();
          if (report === undefined) throw new Error('OPFS flush returned no durability report');
          return report;
        },
      },
    });

    await expect(authority.manager.ensure(planAppliedShadowSubstitutions([]))).resolves.toEqual(
      expect.objectContaining({
        receipt: expect.objectContaining({ storageClass: 'opfs-persisted' }),
      }),
    );
    expect(h.flushCalls()).toBeGreaterThanOrEqual(2);
    await authority.manager.close();
  });

  it('rejects a nonthrowing OPFS failure report even when persisted read-back matches prior bytes', async () => {
    const vfs = new MemoryVfs();
    const plan = planAppliedShadowSubstitutions([]);
    const seed = await createOwnerShadowAssetAuthority({
      ownerStorage: OPFS,
      vfs,
      registry,
      storageManager: {
        persisted: async () => true,
        persist: async () => true,
      },
      durability: {
        persistedVfs: vfs,
        flush: async () => ({ failures: [], total: 0 }),
      },
    });
    const seeded = await seed.manager.ensure(plan);
    await seed.manager.close();
    await vfs.rm(`/.rifty/shadow-assets/v1/ready/${plan.requiredSetDigest}`, { force: true });

    const authority = await createOwnerShadowAssetAuthority({
      ownerStorage: OPFS,
      vfs,
      registry,
      storageManager: {
        persisted: async () => true,
        persist: async () => true,
      },
      durability: {
        persistedVfs: vfs,
        flush: async () => ({
          failures: [
            {
              path: `/.rifty/shadow-assets/v1/receipt/${seeded.receipt.receiptSha256}`,
              op: 'write',
              message: 'QuotaExceededError',
            },
          ],
          total: 1,
        }),
      },
    });

    await expect(authority.manager.ensure(plan)).rejects.toThrow(/shadow storage write failed/);
    await authority.manager.close();
  });

  it.each([
    ['quota failure', 'quota'],
    ['ready pointer visible only in the mutation mirror', 'torn-ready'],
  ] as const)('fault: OPFS publication rejects %s', async (_label, fault) => {
    const h = ownerOpfsHarness(fault);
    const authority = await createOwnerShadowAssetAuthority({
      ownerStorage: OPFS,
      vfs: h.mutationVfs,
      registry,
      storageManager: {
        persisted: async () => true,
        persist: async () => true,
      },
      durability: {
        persistedVfs: h.persistedVfs,
        flush: async () => {
          const report = await h.authority.flush();
          if (report === undefined) throw new Error('OPFS flush returned no durability report');
          return report;
        },
      },
    });

    await expect(authority.manager.ensure(planAppliedShadowSubstitutions([]))).rejects.toThrow(
      /shadow storage write failed/,
    );
    await authority.manager.close();
  });
});
