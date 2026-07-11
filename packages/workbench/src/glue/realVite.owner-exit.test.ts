import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_PROJECT_CATALOG } from '../test-project.ts';
import {
  type RealViteHost,
  type RealViteRuntime,
  type WorkspaceOwnerOptions,
  type WorkspaceOwnerProcessPort,
  type WorkspaceOwnerSpawnRequest,
  type WorkspaceOwnerSpawnResult,
  createRealViteForTesting,
} from './realVite.ts';

const sendVfsWriteSpy = vi.fn();
const readFileBytesSpy = vi.fn<(path: string) => Promise<Uint8Array>>();
const spawnOwner = vi.fn<(request: WorkspaceOwnerSpawnRequest) => WorkspaceOwnerSpawnResult>();

class FakeOwnerProcess implements WorkspaceOwnerProcessPort {
  alive = true;
  readonly sent: unknown[] = [];
  #stdout = new EventEmitter();
  #stderr = new EventEmitter();
  #events = new EventEmitter();

  onMessage(listener: (message: unknown) => void): void {
    this.#events.on('message', listener);
  }
  onExit(listener: (code: unknown) => void): void {
    this.#events.on('exit', listener);
  }
  onStdout(listener: (chunk: unknown) => void): void {
    this.#stdout.on('data', listener);
  }
  onStderr(listener: (chunk: unknown) => void): void {
    this.#stderr.on('data', listener);
  }
  send(message: unknown): boolean {
    if (!this.alive) return false;
    this.sent.push(message);
    return true;
  }
  terminate(): boolean {
    return true;
  }
  emitMessage(message: unknown): void {
    this.#events.emit('message', message);
  }
  die(code: number | null): void {
    this.alive = false;
    this.#events.emit('exit', code);
  }
}

interface TestPreviewBridge {
  dispose(): void;
}

let fakeWorker: FakeOwnerProcess;
let runtime: RealViteRuntime;

beforeEach(() => {
  vi.clearAllMocks();
  readFileBytesSpy.mockResolvedValue(new Uint8Array([1, 2, 3]));
  fakeWorker = new FakeOwnerProcess();
  spawnOwner.mockReturnValue({ ok: true, process: fakeWorker });
  const host: RealViteHost<TestPreviewBridge> = {
    prepareOwner: () => {},
    spawnOwner,
    createArchiveBridge: () => ({
      export: async () => '{}',
      import: async () => {},
      dispose: () => {},
    }),
    createFileReadBridge: () => ({
      readFileBytes: (path) => readFileBytesSpy(path),
      dispose: () => {},
    }),
    sendFallbackWrite: (key, frame) => sendVfsWriteSpy(key, frame),
    createPreviewBridge: () => ({ dispose: () => {} }),
    registerPreview: () => {},
    unregisterPreview: () => {},
    mountPreview: () => () => {},
  };
  runtime = createRealViteForTesting(host);
});

function ownerOptions(): WorkspaceOwnerOptions {
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
  };
}

function sentWrite(): { readonly type: string; readonly opId?: string } | undefined {
  return fakeWorker.sent.find(
    (message): message is { type: string; opId?: string } =>
      !!message &&
      typeof message === 'object' &&
      (message as { readonly type?: unknown }).type === 'rifty:vfs-write',
  );
}

describe('workspace owner death and write acknowledgement', () => {
  it('notifies dev-server listeners with a non-running frame on owner exit', async () => {
    const handle = runtime.startWorkspaceOwner(ownerOptions());
    const frames: { status: string }[] = [];
    handle.onDevServer((frame) => frames.push(frame));

    fakeWorker.die(0);

    expect(frames.length).toBeGreaterThan(0);
    expect(frames.at(-1)?.status).not.toBe('running');
  });

  it('throws on writeFile after owner exit without falling back to a stale channel', async () => {
    const handle = runtime.startWorkspaceOwner(ownerOptions());
    fakeWorker.die(137);

    expect(() => handle.writeFile('/scratch/a.txt', 'hi')).toThrow(/workspace owner/);
    expect(sendVfsWriteSpy).not.toHaveBeenCalled();
  });

  it('throws on writeFrame after owner exit without falling back to a stale channel', async () => {
    const handle = runtime.startWorkspaceOwner(ownerOptions());
    fakeWorker.die(137);

    expect(() =>
      handle.writeFrame({
        type: 'rename',
        from: '/scratch/src/old.js',
        to: '/scratch/src/new.js',
      }),
    ).toThrow(/workspace owner/);
    expect(sendVfsWriteSpy).not.toHaveBeenCalled();
  });

  it('rejects readFileBytes after owner exit without reading a stale bridge', async () => {
    const handle = runtime.startWorkspaceOwner(ownerOptions());
    expect(handle.isAlive()).toBe(true);
    fakeWorker.die(137);

    expect(handle.isAlive()).toBe(false);
    await expect(handle.readFileBytes('/scratch/a.txt')).rejects.toThrow(/workspace owner/);
    expect(readFileBytesSpy).not.toHaveBeenCalled();
  });

  it('rejects generic raw messages after owner exit without sending to the dead worker', async () => {
    const handle = runtime.startWorkspaceOwner(ownerOptions());
    fakeWorker.emitMessage({
      type: 'rifty:workspace-owner-ready',
      port: handle.snapshotPort,
      backend: 'memory',
    });
    fakeWorker.die(137);
    const sentBefore = fakeWorker.sent.length;

    await expect(handle.sendRawMessage({ type: 'host:extension-request' })).rejects.toThrow(
      /workspace owner has exited/,
    );
    expect(fakeWorker.sent).toHaveLength(sentBefore);
  });

  it('sends writeFrame through the live worker', async () => {
    const handle = runtime.startWorkspaceOwner(ownerOptions());

    handle.writeFrame({
      type: 'copy',
      from: '/scratch/src/a.js',
      to: '/scratch/src/a.copy.js',
    });

    expect(sentWrite()).toBeDefined();
    expect(sendVfsWriteSpy).not.toHaveBeenCalled();
  });

  it('reads bytes through the live owner bridge', async () => {
    const handle = runtime.startWorkspaceOwner(ownerOptions());

    await expect(handle.readFileBytes('/scratch/a.txt')).resolves.toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(readFileBytesSpy).toHaveBeenCalledWith('/scratch/a.txt');
  });

  it('resolves writeFrameAcked only after the owner ack', async () => {
    const handle = runtime.startWorkspaceOwner(ownerOptions());
    const acked = handle.writeFrameAcked({
      type: 'mkdir',
      path: '/scratch/acked',
      recursive: false,
    });
    const write = sentWrite();
    expect(write?.opId).toEqual(expect.any(String));
    if (!write?.opId) throw new Error('expected an acked VFS write');
    let resolved = false;
    void acked.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    fakeWorker.emitMessage({ type: 'rifty:vfs-write-ack', opId: write.opId, ok: true });

    await acked;
    expect(resolved).toBe(true);
  });

  it('rejects writeFrameAcked with the owner-side apply error', async () => {
    const handle = runtime.startWorkspaceOwner(ownerOptions());
    const acked = handle.writeFrameAcked({
      type: 'rename',
      from: '/scratch/a.txt',
      to: '/scratch/b.txt',
    });
    const write = sentWrite();
    if (!write?.opId) throw new Error('expected an acked VFS write');

    fakeWorker.emitMessage({
      type: 'rifty:vfs-write-ack',
      opId: write.opId,
      ok: false,
      error: { name: 'Error', message: '"b.txt" already exists' },
    });

    await expect(acked).rejects.toThrow(/already exists/);
  });

  it('rejects in-flight writeFrameAcked calls when the owner exits', async () => {
    const handle = runtime.startWorkspaceOwner(ownerOptions());
    const acked = handle.writeFrameAcked({
      type: 'copy',
      from: '/scratch/a.txt',
      to: '/scratch/b.txt',
    });

    fakeWorker.die(137);

    await expect(acked).rejects.toThrow(/workspace owner exited/);
  });
});
