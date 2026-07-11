import { describe, expect, it, vi } from 'vitest';
import { TEST_PROJECT_CATALOG } from '../test-project.ts';
import {
  type RealViteHost,
  type WorkspaceOwnerProcessPort,
  type WorkspaceOwnerSpawnRequest,
  createRealViteForTesting,
} from './realVite.ts';

class TestOwnerProcess implements WorkspaceOwnerProcessPort {
  readonly sent: unknown[] = [];
  readonly #exitListeners = new Set<(code: unknown) => void>();

  send(message: unknown): boolean {
    this.sent.push(message);
    return true;
  }

  terminate(): boolean {
    for (const listener of this.#exitListeners) listener(0);
    return true;
  }

  onMessage(): void {}
  onExit(listener: (code: unknown) => void): void {
    this.#exitListeners.add(listener);
  }
  onStdout(): void {}
  onStderr(): void {}
}

interface TestPreviewBridge {
  dispose(): void;
}

function ownerOptions(workspaceId: string) {
  return {
    assets: {
      ownerWorkerUrl: 'boot.js',
      kernelWorkerUrl: 'kernel.js',
      nodeWorkerUrl: 'node.js',
      devServerWorkerUrl: 'dev.js',
      serviceWorkerUrl: 'sw.js',
      sqliteWasmUrl: 'sqlite.wasm',
      esbuildWasmUrl: 'esbuild.wasm',
    },
    registry: { registryUrl: 'https://registry.example/proxy' },
    catalog: TEST_PROJECT_CATALOG,
    workspaceId,
  };
}

function hostHarness() {
  const owner = new TestOwnerProcess();
  const spawnRequests: WorkspaceOwnerSpawnRequest[] = [];
  const previewEvents: string[] = [];
  const host: RealViteHost<TestPreviewBridge> = {
    prepareOwner: vi.fn(),
    spawnOwner(request) {
      spawnRequests.push(request);
      return { ok: true, process: owner };
    },
    createArchiveBridge: () => ({
      export: async () => '{}',
      import: async () => {},
      dispose: () => {},
    }),
    createFileReadBridge: () => ({
      readFileBytes: async () => new Uint8Array(),
      dispose: () => {},
    }),
    sendFallbackWrite: () => {},
    createPreviewBridge() {
      previewEvents.push('create');
      return { dispose: () => previewEvents.push('dispose') };
    },
    registerPreview() {
      previewEvents.push('register');
    },
    unregisterPreview() {
      previewEvents.push('unregister');
    },
    mountPreview() {
      previewEvents.push('mount');
      return () => previewEvents.push('unmount');
    },
  };
  return { host, owner, previewEvents, spawnRequests };
}

describe('real Vite host seam', () => {
  it('keeps owner and preview effects bound to the host instance that created them', () => {
    const left = hostHarness();
    const right = hostHarness();
    const leftRuntime = createRealViteForTesting(left.host);
    const rightRuntime = createRealViteForTesting(right.host);

    const owner = leftRuntime.startWorkspaceOwner(ownerOptions('left'));
    owner.writeFile('/scratch/left.txt', 'left');
    const unmount = rightRuntime.wirePreviewBridge(5199, 'right-owner');
    unmount();

    expect(left.spawnRequests).toHaveLength(1);
    expect(right.spawnRequests).toHaveLength(0);
    expect(left.owner.sent).toContainEqual(expect.objectContaining({ type: 'rifty:vfs-write' }));
    expect(right.owner.sent).toEqual([]);
    expect(left.previewEvents).toEqual([]);
    expect(right.previewEvents).toEqual([
      'create',
      'register',
      'mount',
      'unmount',
      'unregister',
      'dispose',
    ]);

    owner.close();
  });
});
