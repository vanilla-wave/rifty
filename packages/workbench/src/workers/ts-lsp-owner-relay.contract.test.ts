import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createTsLspOwnerRelay } from './ts-lsp-owner-relay.ts';

const PROJECT_ROOT = '/.rifty/workbench/v1/projects/project-a/tree';

class FakeChild extends EventEmitter {
  readonly kind = 'worker' as const;
  readonly sent: unknown[] = [];
  readonly out = new EventEmitter();
  readonly err = new EventEmitter();
  killed = 0;

  send(message: unknown): boolean {
    this.sent.push(structuredClone(message));
    return true;
  }

  stdout(): EventEmitter {
    return this.out;
  }

  stderr(): EventEmitter {
    return this.err;
  }

  kill(): boolean {
    this.killed += 1;
    this.emit('exit', 0, 'SIGTERM');
    return true;
  }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('session-bound TS-LSP owner relay', () => {
  it('quiesces packages, lazily spawns the real worker shape, relays exact responses, and physically closes it', async () => {
    const packageReady = deferred();
    const child = new FakeChild();
    const spawn = vi.fn(() => child);
    const outgoing: unknown[] = [];
    const relay = createTsLspOwnerRelay({
      projectRoot: PROJECT_ROOT,
      workerUrl: 'ts-lsp-worker.js',
      nodeWorkerRuntimeEnv: { RIFTY_KERNEL_WORKER_URL: 'kernel.js' },
      packages: { quiesce: () => packageReady.promise },
      spawnWorker: spawn,
      send(message) {
        outgoing.push(structuredClone(message));
        return undefined;
      },
      log: () => {},
    });

    const request = {
      type: 'rifty:ts-lsp' as const,
      request: { id: 7, type: 'ts:init' as const, projectRoot: PROJECT_ROOT },
    };
    const handled = relay.handle(request);
    await Promise.resolve();
    expect(spawn).not.toHaveBeenCalled();
    packageReady.resolve();
    await handled;

    expect(spawn).toHaveBeenCalledWith({
      entry: { kind: 'url', url: 'ts-lsp-worker.js' },
      argv: ['rifty', 'ts-lsp'],
      env: {
        RIFTY_KERNEL_WORKER_URL: 'kernel.js',
        RIFTY_REMOTE_FS: '1',
        RIFTY_RFV_ROOT: PROJECT_ROOT,
      },
      cwd: PROJECT_ROOT,
      serve: true,
    });
    expect(child.sent).toEqual([request]);

    child.emit('message', {
      type: 'rifty:ts-lsp',
      response: { id: 7, ok: true, kind: 'ack' },
    });
    expect(outgoing).toEqual([
      { type: 'rifty:ts-lsp', response: { id: 7, ok: true, kind: 'ack' } },
    ]);

    await relay.close();
    expect(child.killed).toBe(1);
    await expect(relay.handle(request)).rejects.toThrow('closed');
  });

  it('rejects a forged init root and child corruption without forwarding unknown state', async () => {
    const child = new FakeChild();
    const outgoing: unknown[] = [];
    const relay = createTsLspOwnerRelay({
      projectRoot: PROJECT_ROOT,
      workerUrl: 'ts-lsp-worker.js',
      nodeWorkerRuntimeEnv: {},
      packages: { quiesce: async () => {} },
      spawnWorker: () => child,
      send(message) {
        outgoing.push(structuredClone(message));
        return undefined;
      },
      log: () => {},
    });

    await relay.handle({
      type: 'rifty:ts-lsp',
      request: { id: 1, type: 'ts:init', projectRoot: '/forged' },
    });
    expect(child.sent).toEqual([]);
    expect(outgoing).toEqual([
      {
        type: 'rifty:ts-lsp',
        response: {
          id: 1,
          ok: false,
          kind: 'error',
          error: { name: 'TypeError', message: expect.stringContaining('project root') },
        },
      },
    ]);

    outgoing.length = 0;
    await relay.handle({
      type: 'rifty:ts-lsp',
      request: { id: 2, type: 'ts:init', projectRoot: PROJECT_ROOT },
    });
    child.emit('message', {
      type: 'rifty:ts-lsp',
      response: { id: 2, ok: true, kind: 'ack', ownerBridgeKey: 'old-seam' },
    });
    expect(child.killed).toBe(1);
    expect(outgoing).toEqual([
      {
        type: 'rifty:ts-lsp',
        response: {
          id: 2,
          ok: false,
          kind: 'error',
          error: { name: 'TypeError', message: expect.stringContaining('TS response') },
        },
      },
    ]);
  });

  it('turns a child crash into correlated loud failures for every admitted request', async () => {
    const child = new FakeChild();
    const outgoing: unknown[] = [];
    const relay = createTsLspOwnerRelay({
      projectRoot: PROJECT_ROOT,
      workerUrl: 'ts-lsp-worker.js',
      nodeWorkerRuntimeEnv: {},
      packages: { quiesce: async () => {} },
      spawnWorker: () => child,
      send(message) {
        outgoing.push(structuredClone(message));
        return undefined;
      },
      log: () => {},
    });

    await relay.handle({
      type: 'rifty:ts-lsp',
      request: { id: 4, type: 'ts:init', projectRoot: PROJECT_ROOT },
    });
    child.emit('exit', 9, null);
    expect(outgoing).toEqual([
      {
        type: 'rifty:ts-lsp',
        response: {
          id: 4,
          ok: false,
          kind: 'error',
          error: { name: 'Error', message: expect.stringContaining('exited') },
        },
      },
    ]);
  });

  it('MessagePort peer-death fault: fails admitted requests with the physical cause', async () => {
    const child = new FakeChild();
    const outgoing: unknown[] = [];
    const relay = createTsLspOwnerRelay({
      projectRoot: PROJECT_ROOT,
      workerUrl: 'ts-lsp-worker.js',
      nodeWorkerRuntimeEnv: {},
      packages: { quiesce: async () => {} },
      spawnWorker: () => child,
      send(message) {
        outgoing.push(structuredClone(message));
        return undefined;
      },
      log: () => {},
    });
    await relay.handle({
      type: 'rifty:ts-lsp',
      request: { id: 5, type: 'ts:init', projectRoot: PROJECT_ROOT },
    });
    const peerFailure = new Error('TS worker peer died');

    child.emit('peererror', peerFailure);
    const afterPeer = structuredClone(outgoing);
    await relay.close();
    expect(afterPeer).toEqual([
      {
        type: 'rifty:ts-lsp',
        response: {
          id: 5,
          ok: false,
          kind: 'error',
          error: { name: 'Error', message: peerFailure.message },
        },
      },
    ]);
  });
});
