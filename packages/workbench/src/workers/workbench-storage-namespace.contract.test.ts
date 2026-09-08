import type { PersistFailureReport } from '@riftydev/vfs';
import { createMemoryFs } from '@riftydev/vfs/internal';
import { describe, expect, it, vi } from 'vitest';
import {
  type WorkbenchOwnerStorageInstallers,
  installWorkbenchOwnerStorageAuthority,
} from './workbench-owner-storage.ts';

function installers(): WorkbenchOwnerStorageInstallers {
  const { vfs, fsSync } = createMemoryFs();
  const opfsSync = Object.assign(fsSync, {
    flush: async (): Promise<PersistFailureReport> => ({ failures: [], total: 0 }),
  });
  return {
    openMemory: vi.fn(() => {}),
    openOpfs: vi.fn(async () => ({ vfs, fsSync: opfsSync })),
  };
}

describe('Workbench owner storage namespace (I4)', () => {
  it('opens OPFS with the selected namespace and proofs on that bound root', async () => {
    const h = installers();
    const opened = await h.openOpfs();
    h.openOpfs = vi.fn(async () => opened);
    const options = {
      installers: h,
      proofTimeoutMs: 50,
      createProofId: () => 'proof-ns',
      namespace: 'plugin-sandbox',
    };

    const { snapshot } = await installWorkbenchOwnerStorageAuthority('required', options);
    expect(snapshot).toEqual({ policy: 'required', backend: 'opfs', durability: 'durable' });
    expect(h.openOpfs).toHaveBeenCalledWith({ namespace: 'plugin-sandbox' });
    expect(await opened.vfs.exists('/.rifty/workbench/v1/storage-proof/proof-ns')).toBe(false);
  });
});
