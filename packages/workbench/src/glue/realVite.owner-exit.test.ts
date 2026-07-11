import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_PROJECT_CATALOG } from '../test-project.ts';
import type { WorkspaceOwnerOptions } from './realVite.ts';

// Regression heirs of the app-owned suite retired when realVite moved here.
// Only transport boundaries are faked; every assertion drives the real owner
// handle lifecycle and write/read acknowledgement logic.
const sendVfsWriteSpy = vi.fn();
const readFileBytesSpy = vi.fn();
const spawnWorker = vi.fn();

vi.mock('@riftydev/kernel', () => ({
  globalProcessManager: {
    spawnWorker: (...args: unknown[]) => spawnWorker(...args),
  },
  isSabIpcSupported: () => true,
  setKernelWorkerUrl: () => {},
}));

vi.mock('@riftydev/net', () => ({
  bridgeCrossRealmPreview: () => ({ dispose: () => {} }),
  registerPort: () => {},
  unregisterPort: () => {},
}));

vi.mock('./vfs-write-port.ts', async () => {
  const actual = await vi.importActual<typeof import('./vfs-write-port.ts')>('./vfs-write-port.ts');
  return {
    ...actual,
    sendVfsWrite: (...args: unknown[]) => sendVfsWriteSpy(...args),
  };
});

vi.mock('./workspace-archive-port.ts', () => ({
  bridgeWorkspaceArchive: () => ({
    export: async () => '{}',
    import: async () => {},
    dispose: () => {},
  }),
}));

vi.mock('./workspace-file-read-port.ts', () => ({
  bridgeWorkspaceFileReads: () => ({
    readFileBytes: (...args: unknown[]) => readFileBytesSpy(...args),
    dispose: () => {},
  }),
}));

vi.mock('./preview-bridge-wiring.ts', () => ({
  mountPlaygroundPreviewBridge: () => () => {},
}));

class FakeWorker extends EventEmitter {
  readonly kind = 'worker' as const;
  alive = true;
  readonly sent: unknown[] = [];
  #stdout = new EventEmitter();
  #stderr = new EventEmitter();

  stdout(): EventEmitter {
    return this.#stdout;
  }

  stderr(): EventEmitter {
    return this.#stderr;
  }

  send(message: unknown): boolean {
    if (!this.alive) return false;
    this.sent.push(message);
    return true;
  }

  kill(): boolean {
    return true;
  }

  die(code: number | null): void {
    this.alive = false;
    this.emit('exit', code);
  }
}

let fakeWorker: FakeWorker;

beforeEach(() => {
  vi.resetModules();
  sendVfsWriteSpy.mockClear();
  readFileBytesSpy.mockReset();
  readFileBytesSpy.mockResolvedValue(new Uint8Array([1, 2, 3]));
  fakeWorker = new FakeWorker();
  spawnWorker.mockReturnValue(fakeWorker);
});

afterEach(() => {
  vi.clearAllMocks();
});

async function importOwner(): Promise<typeof import('./realVite.ts')> {
  return import('./realVite.ts');
}

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
    const { startWorkspaceOwner } = await importOwner();
    const handle = startWorkspaceOwner(ownerOptions());
    const frames: { status: string }[] = [];
    handle.onDevServer((frame) => frames.push(frame));

    fakeWorker.die(0);

    expect(frames.length).toBeGreaterThan(0);
    expect(frames.at(-1)?.status).not.toBe('running');
  });

  it('throws on writeFile after owner exit without falling back to a stale channel', async () => {
    const { startWorkspaceOwner } = await importOwner();
    const handle = startWorkspaceOwner(ownerOptions());
    fakeWorker.die(137);

    expect(() => handle.writeFile('/scratch/a.txt', 'hi')).toThrow(/workspace owner/);
    expect(sendVfsWriteSpy).not.toHaveBeenCalled();
  });

  it('throws on writeFrame after owner exit without falling back to a stale channel', async () => {
    const { startWorkspaceOwner } = await importOwner();
    const handle = startWorkspaceOwner(ownerOptions());
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
    const { startWorkspaceOwner } = await importOwner();
    const handle = startWorkspaceOwner(ownerOptions());
    expect(handle.isAlive()).toBe(true);
    fakeWorker.die(137);

    expect(handle.isAlive()).toBe(false);
    await expect(handle.readFileBytes('/scratch/a.txt')).rejects.toThrow(/workspace owner/);
    expect(readFileBytesSpy).not.toHaveBeenCalled();
  });

  it('rejects generic raw messages after owner exit without sending to the dead worker', async () => {
    const { startWorkspaceOwner } = await importOwner();
    const handle = startWorkspaceOwner(ownerOptions());
    fakeWorker.emit('message', {
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
    const { startWorkspaceOwner } = await importOwner();
    const handle = startWorkspaceOwner(ownerOptions());

    handle.writeFrame({
      type: 'copy',
      from: '/scratch/src/a.js',
      to: '/scratch/src/a.copy.js',
    });

    expect(sentWrite()).toBeDefined();
    expect(sendVfsWriteSpy).not.toHaveBeenCalled();
  });

  it('reads bytes through the live owner bridge', async () => {
    const { startWorkspaceOwner } = await importOwner();
    const handle = startWorkspaceOwner(ownerOptions());

    await expect(handle.readFileBytes('/scratch/a.txt')).resolves.toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(readFileBytesSpy).toHaveBeenCalledWith('/scratch/a.txt');
  });

  it('resolves writeFrameAcked only after the owner ack', async () => {
    const { startWorkspaceOwner } = await importOwner();
    const handle = startWorkspaceOwner(ownerOptions());
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

    fakeWorker.emit('message', { type: 'rifty:vfs-write-ack', opId: write.opId, ok: true });

    await acked;
    expect(resolved).toBe(true);
  });

  it('rejects writeFrameAcked with the owner-side apply error', async () => {
    const { startWorkspaceOwner } = await importOwner();
    const handle = startWorkspaceOwner(ownerOptions());
    const acked = handle.writeFrameAcked({
      type: 'rename',
      from: '/scratch/a.txt',
      to: '/scratch/b.txt',
    });
    const write = sentWrite();
    if (!write?.opId) throw new Error('expected an acked VFS write');

    fakeWorker.emit('message', {
      type: 'rifty:vfs-write-ack',
      opId: write.opId,
      ok: false,
      error: { name: 'Error', message: '"b.txt" already exists' },
    });

    await expect(acked).rejects.toThrow(/already exists/);
  });

  it('rejects in-flight writeFrameAcked calls when the owner exits', async () => {
    const { startWorkspaceOwner } = await importOwner();
    const handle = startWorkspaceOwner(ownerOptions());
    const acked = handle.writeFrameAcked({
      type: 'copy',
      from: '/scratch/a.txt',
      to: '/scratch/b.txt',
    });

    fakeWorker.die(137);

    await expect(acked).rejects.toThrow(/workspace owner exited/);
  });
});
