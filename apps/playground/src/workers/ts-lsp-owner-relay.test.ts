import { EventEmitter } from 'node:events';
import type { ProjectSpec } from '@riftydev/workbench';
import { describe, expect, it, vi } from 'vitest';
import { createTsLspOwnerRelay } from './ts-lsp-owner-relay.ts';

class FakeChild extends EventEmitter {
  readonly kind = 'worker' as const;
  readonly sent: unknown[] = [];
  readonly out = new EventEmitter();
  readonly err = new EventEmitter();
  send(message: unknown): boolean {
    this.sent.push(message);
    return true;
  }
  stdout(): EventEmitter {
    return this.out;
  }
  stderr(): EventEmitter {
    return this.err;
  }
}

const tsTemplate = {
  id: 'typescript',
  install: { typescript: '5.9.3' },
} as unknown as ProjectSpec;
const jsTemplate = { id: 'vite', install: {} } as unknown as ProjectSpec;

describe('app-owned TS-LSP owner relay', () => {
  it('waits for active-project readiness and workspace TypeScript before lazy spawn', async () => {
    const incoming = new Set<(message: unknown) => void>();
    const outgoing: unknown[] = [];
    const child = new FakeChild();
    const spawnWorker = vi.fn(() => child);
    let releaseReady: () => void = () => {};
    const projectReady = new Promise<void>((resolve) => {
      releaseReady = resolve;
    });
    let typescriptExists = false;
    const relay = createTsLspOwnerRelay({
      workerUrl: 'ts-worker.js',
      root: '/scratch',
      ownerBridgeKey: 'owner:a',
      initialTemplateId: 'typescript',
      resolveProjectSpec: () => tsTemplate,
      waitForActiveProjectReady: () => projectReady,
      existsSync: () => typescriptExists,
      spawnWorker,
      onOwnerMessage: (listener) => {
        incoming.add(listener);
        return () => incoming.delete(listener);
      },
      sendOwnerMessage: (message) => outgoing.push(message),
      log: () => {},
      now: () => 0,
      sleep: async () => {
        typescriptExists = true;
      },
    });
    const request = {
      type: 'rifty:ts-lsp',
      request: { id: 7, type: 'ts:init', projectRoot: '/scratch' },
      ownerBridgeKey: 'owner:a',
    };

    for (const listener of incoming) listener(request);
    await Promise.resolve();
    expect(spawnWorker).not.toHaveBeenCalled();

    releaseReady();
    await vi.waitFor(() => expect(spawnWorker).toHaveBeenCalledTimes(1));
    expect(spawnWorker).toHaveBeenCalledWith(
      'ts-lsp',
      expect.objectContaining({
        entry: { kind: 'url', url: 'ts-worker.js' },
        env: { RIFTY_REMOTE_FS: '1', RIFTY_RFV_ROOT: '/scratch' },
        cwd: '/scratch',
        serve: true,
      }),
      1,
    );
    expect(child.sent).toEqual([request]);

    child.emit('message', {
      type: 'rifty:ts-lsp',
      response: { id: 7, ok: true, kind: 'init', result: {} },
    });
    expect(outgoing).toEqual([
      {
        type: 'rifty:ts-lsp',
        response: { id: 7, ok: true, kind: 'init', result: {} },
        ownerBridgeKey: 'owner:a',
      },
    ]);
    relay.dispose();
  });

  it('tracks dev-config frames and skips the TypeScript-file gate for JS templates', async () => {
    const incoming = new Set<(message: unknown) => void>();
    const child = new FakeChild();
    const existsSync = vi.fn(() => false);
    const relay = createTsLspOwnerRelay({
      workerUrl: 'ts-worker.js',
      root: '/scratch',
      ownerBridgeKey: 'owner:a',
      initialTemplateId: 'typescript',
      resolveProjectSpec: (id) => (id === 'vite' ? jsTemplate : tsTemplate),
      waitForActiveProjectReady: async () => {},
      existsSync,
      spawnWorker: () => child,
      onOwnerMessage: (listener) => {
        incoming.add(listener);
        return () => incoming.delete(listener);
      },
      sendOwnerMessage: () => {},
      log: () => {},
    });

    for (const listener of incoming) {
      listener({
        type: 'rifty:pty',
        frame: { type: 'pty:dev-config', id: 'cfg', templateId: 'vite' },
      });
      listener({
        type: 'rifty:ts-lsp',
        request: { id: 8, type: 'ts:init', projectRoot: '/scratch' },
        ownerBridgeKey: 'owner:a',
      });
    }
    await vi.waitFor(() => expect(child.sent).toHaveLength(1));
    expect(existsSync).not.toHaveBeenCalled();
    relay.dispose();
  });
});
