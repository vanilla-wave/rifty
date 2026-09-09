import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KernelIpc } from './worker-runtime-globals.ts';

const installWorkbenchOwnerStorageAuthority = vi.hoisted(() =>
  vi.fn(async () => ({
    snapshot: {
      policy: 'ephemeral' as const,
      backend: 'memory' as const,
      durability: 'ephemeral' as const,
    },
  })),
);

vi.mock('./workbench-owner-storage.ts', () => ({
  installWorkbenchOwnerStorageAuthority,
}));

import { runWorkbenchOwner } from './workbench-owner-runtime.ts';

function bootConfig(startupMs: number) {
  return {
    deployment: {
      workers: {
        kernel: 'https://workbench.invalid/kernel.js',
        node: 'https://workbench.invalid/node.js',
        devServer: 'https://workbench.invalid/dev-server.js',
      },
      wasm: { sqlite: 'https://workbench.invalid/sqlite.wasm' },
      previewProbeTimeoutMs: 3_000,
      ownerStartupTimeoutMs: startupMs,
    },
    packageAcquisition: {},
    storage: { persistence: 'ephemeral' as const },
  };
}

describe('owner runtime startup budget (I7 Acc 5)', () => {
  afterEach(() => {
    installWorkbenchOwnerStorageAuthority.mockClear();
  });

  it('passes initialize ownerStartupTimeoutMs to the storage installer', async () => {
    let deliver: ((message: unknown) => void) | undefined;
    const ipc: KernelIpc = {
      onMessage(handler) {
        deliver = handler;
      },
      send() {},
    };
    const running = runWorkbenchOwner(ipc);
    void running.catch(() => {});
    await Promise.resolve();
    if (deliver === undefined) throw new Error('owner IPC receive was not installed');
    deliver({ type: 'workbench:initialize', config: bootConfig(80) });
    try {
      await running;
    } catch {
      // inspect rejects today; later setup may still throw after install
    }
    expect(installWorkbenchOwnerStorageAuthority).toHaveBeenCalledWith(
      'ephemeral',
      expect.objectContaining({ proofTimeoutMs: 80 }),
    );
  });
});
