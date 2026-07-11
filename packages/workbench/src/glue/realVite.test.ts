import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectSpec } from '../project-spec.ts';
import { TEST_PROJECT_CATALOG, TEST_VITE_TEMPLATE } from '../test-project.ts';
import type { WorkspaceOwnerOptions } from './realVite.ts';

// Behavioral heirs of the retired realVite source greps (epic
// playground-testable-core). Same seam as realVite.owner-exit.test.ts: mock
// only the transport boundaries (kernel spawn, net registry, port bridges —
// node has no Worker; the real factory is covered by tests/browser-unit/) and
// drive the REAL startWorkspaceOwner / wirePreviewBridge wiring.

const sendVfsWriteSpy = vi.fn();
const spawnWorker = vi.fn();
const bridgeCrossRealmPreviewSpy = vi.fn();
const registerPortSpy = vi.fn();
const unregisterPortSpy = vi.fn();
const mountPlaygroundPreviewBridgeSpy = vi.fn();
const tearSwBridgeSpy = vi.fn();
const previewDisposeSpy = vi.fn();
const archiveDisposeSpy = vi.fn();
const fileReadDisposeSpy = vi.fn();
const bridgeWorkspaceArchiveSpy = vi.fn();
const bridgeWorkspaceFileReadsSpy = vi.fn();

vi.mock('@riftydev/kernel', () => ({
  globalProcessManager: {
    spawnWorker: (...args: unknown[]) => spawnWorker(...args),
  },
  isSabIpcSupported: () => true,
  setKernelWorkerUrl: () => {},
}));

vi.mock('@riftydev/net', () => ({
  bridgeCrossRealmPreview: (...args: unknown[]) => bridgeCrossRealmPreviewSpy(...args),
  registerPort: (...args: unknown[]) => registerPortSpy(...args),
  unregisterPort: (...args: unknown[]) => unregisterPortSpy(...args),
}));

vi.mock('./vfs-write-port.ts', async () => {
  const actual = await vi.importActual<typeof import('./vfs-write-port.ts')>('./vfs-write-port.ts');
  return {
    ...actual,
    sendVfsWrite: (...args: unknown[]) => sendVfsWriteSpy(...args),
  };
});

vi.mock('./preview-bridge-wiring.ts', () => ({
  mountPlaygroundPreviewBridge: (...args: unknown[]) => mountPlaygroundPreviewBridgeSpy(...args),
}));

vi.mock('./workspace-archive-port.ts', () => ({
  bridgeWorkspaceArchive: (...args: unknown[]) => bridgeWorkspaceArchiveSpy(...args),
}));

vi.mock('./workspace-file-read-port.ts', () => ({
  bridgeWorkspaceFileReads: (...args: unknown[]) => bridgeWorkspaceFileReadsSpy(...args),
}));

/** Minimal faithful stand-in for the kernel `WorkerProcessHandle`. */
class FakeWorker extends EventEmitter {
  readonly kind = 'worker' as const;
  alive = true;
  /** Simulate a refused (but not dead) IPC channel: send() returns false. */
  refuseSends = false;
  killCalls = 0;
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
    if (!this.alive || this.refuseSends) return false;
    this.sent.push(message);
    return true;
  }
  kill(): boolean {
    this.killCalls += 1;
    return true;
  }
}

interface SpawnedWorkerOptions {
  readonly entry: { readonly kind: string; readonly url: unknown };
  readonly env: Record<string, string>;
}

function spawnedOptions(call = 0): SpawnedWorkerOptions {
  const args = spawnWorker.mock.calls[call] as unknown as
    | [string, SpawnedWorkerOptions]
    | undefined;
  if (!args) throw new Error(`expected spawnWorker call #${call}`);
  return args[1];
}

let fakeWorker: FakeWorker;
let previewBridge: { dispose: typeof previewDisposeSpy };

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  fakeWorker = new FakeWorker();
  spawnWorker.mockImplementation(() => fakeWorker);
  previewBridge = { dispose: previewDisposeSpy };
  bridgeCrossRealmPreviewSpy.mockImplementation(() => previewBridge);
  mountPlaygroundPreviewBridgeSpy.mockImplementation(() => tearSwBridgeSpy);
  bridgeWorkspaceArchiveSpy.mockImplementation(() => ({
    export: async () => '{}',
    import: async () => {},
    dispose: archiveDisposeSpy,
  }));
  bridgeWorkspaceFileReadsSpy.mockImplementation(() => ({
    readFileBytes: async () => new Uint8Array(),
    dispose: fileReadDisposeSpy,
  }));
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function importOwner(): Promise<typeof import('./realVite.ts')> {
  return import('./realVite.ts');
}

function ownerOptions(overrides: Partial<WorkspaceOwnerOptions> = {}): WorkspaceOwnerOptions {
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
    ...overrides,
  };
}

describe('workspace owner page→owner VFS writes (ADR-0146: owner store is the source of truth)', () => {
  it('routes editor writes over kernel worker IPC while the owner channel accepts sends', async () => {
    const { startWorkspaceOwner } = await importOwner();
    const handle = startWorkspaceOwner(ownerOptions());

    handle.writeFile('/scratch/src/a.txt', 'hi');

    const ipc = fakeWorker.sent.find(
      (m): m is { type: string; frame: { type: string; path: string; data: Uint8Array } } =>
        !!m && typeof m === 'object' && (m as { type?: unknown }).type === 'rifty:vfs-write',
    );
    expect(ipc).toBeDefined();
    if (!ipc) throw new Error('expected a rifty:vfs-write IPC envelope');
    expect(ipc.frame.type).toBe('write');
    expect(ipc.frame.path).toBe('/scratch/src/a.txt');
    expect(new TextDecoder().decode(ipc.frame.data)).toBe('hi');
    expect(sendVfsWriteSpy).not.toHaveBeenCalled();
  });

  it('falls back to the BroadcastChannel writer only when the IPC send is refused', async () => {
    const { startWorkspaceOwner } = await importOwner();
    const handle = startWorkspaceOwner(ownerOptions());

    fakeWorker.refuseSends = true;
    handle.writeFile('/scratch/src/a.txt', 'hi');

    expect(fakeWorker.sent).toEqual([]);
    expect(sendVfsWriteSpy).toHaveBeenCalledTimes(1);
    expect(sendVfsWriteSpy).toHaveBeenCalledWith(
      handle.snapshotPort,
      expect.objectContaining({ type: 'write', path: '/scratch/src/a.txt' }),
    );
  });
});

describe('page-side preview bridge (ADR-0148 / ADR-0150 P6b / ADR-0160)', () => {
  it('registers the cross-realm route keyed by owner token + served port, and tears it down', async () => {
    const { wirePreviewBridge } = await importOwner();

    const teardown = wirePreviewBridge(5199, 'token-abc', '/p/');

    expect(bridgeCrossRealmPreviewSpy).toHaveBeenCalledWith(5199, { scope: '/p/' });
    expect(registerPortSpy).toHaveBeenCalledWith(5199, previewBridge);
    expect(mountPlaygroundPreviewBridgeSpy).toHaveBeenCalledWith(previewBridge, {
      ownerToken: 'token-abc',
      ports: [5199],
    });
    expect(tearSwBridgeSpy).not.toHaveBeenCalled();

    teardown();

    expect(tearSwBridgeSpy).toHaveBeenCalledTimes(1);
    expect(unregisterPortSpy).toHaveBeenCalledWith(5199);
    expect(previewDisposeSpy).toHaveBeenCalledTimes(1);
  });

  it('rolls back the registered port and cross-realm bridge when SW mounting fails', async () => {
    const mountError = new Error('SW mount failed');
    const unregisterError = new Error('port unregister failed');
    mountPlaygroundPreviewBridgeSpy.mockImplementation(() => {
      throw mountError;
    });
    unregisterPortSpy.mockImplementation(() => {
      throw unregisterError;
    });
    const { wirePreviewBridge } = await importOwner();

    let failure: unknown;
    try {
      wirePreviewBridge(5199, 'token-abc');
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      name: 'AggregateError',
      errors: [mountError, unregisterError],
    });
    expect(unregisterPortSpy).toHaveBeenCalledWith(5199);
    expect(previewDisposeSpy).toHaveBeenCalledOnce();
  });

  it('attempts every preview teardown once before aggregating failures', async () => {
    tearSwBridgeSpy.mockImplementation(() => {
      throw new Error('SW teardown failed');
    });
    unregisterPortSpy.mockImplementation(() => {
      throw new Error('port unregister failed');
    });
    previewDisposeSpy.mockImplementation(() => {
      throw new Error('preview bridge dispose failed');
    });
    const { wirePreviewBridge } = await importOwner();
    const teardown = wirePreviewBridge(5199, 'token-abc');

    expect(() => teardown()).toThrow(AggregateError);
    expect(tearSwBridgeSpy).toHaveBeenCalledOnce();
    expect(unregisterPortSpy).toHaveBeenCalledOnce();
    expect(previewDisposeSpy).toHaveBeenCalledOnce();
    expect(() => teardown()).not.toThrow();
    expect(tearSwBridgeSpy).toHaveBeenCalledOnce();
    expect(unregisterPortSpy).toHaveBeenCalledOnce();
    expect(previewDisposeSpy).toHaveBeenCalledOnce();
  });

  it('generates the preview owner token page-side, never threading it to the owner env', async () => {
    const { startWorkspaceOwner } = await importOwner();
    const first = startWorkspaceOwner(ownerOptions());
    const second = startWorkspaceOwner(ownerOptions());

    expect(first.previewOwnerToken.length).toBeGreaterThan(0);
    // Generated per handle, not a shared constant.
    expect(second.previewOwnerToken).not.toBe(first.previewOwnerToken);
    // ADR-0150 P6b: the token keys the PAGE-side SW route only; it must not
    // leak into the spawned owner's env (the dev-server route is port-keyed).
    const env = spawnedOptions(0).env;
    expect(
      Object.values(env).some((value) => String(value).includes(first.previewOwnerToken)),
    ).toBe(false);
  });
});

describe('workspace owner spawn contract', () => {
  it('kills an unexpected non-worker spawn result before failing loudly', async () => {
    const kill = vi.fn();
    spawnWorker.mockReturnValueOnce({ kind: 'process', kill });
    const { startWorkspaceOwner } = await importOwner();

    expect(() => startWorkspaceOwner(ownerOptions())).toThrow(/expected 'worker'/);
    expect(kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('rolls back an already-spawned worker when page bridge construction fails', async () => {
    const bridgeError = new Error('file-read bridge construction failed');
    bridgeWorkspaceFileReadsSpy.mockImplementation(() => {
      throw bridgeError;
    });
    const { startWorkspaceOwner } = await importOwner();

    expect(() => startWorkspaceOwner(ownerOptions())).toThrow(bridgeError);
    expect(archiveDisposeSpy).toHaveBeenCalledOnce();
    expect(fakeWorker.killCalls).toBe(1);
  });

  it('attempts both bridge disposals and worker kill before aggregating close failures', async () => {
    archiveDisposeSpy.mockImplementation(() => {
      throw new Error('archive dispose failed');
    });
    fileReadDisposeSpy.mockImplementation(() => {
      throw new Error('file read dispose failed');
    });
    const { startWorkspaceOwner } = await importOwner();
    const handle = startWorkspaceOwner(ownerOptions());

    expect(() => handle.close()).toThrow(AggregateError);
    expect(archiveDisposeSpy).toHaveBeenCalledOnce();
    expect(fileReadDisposeSpy).toHaveBeenCalledOnce();
    expect(fakeWorker.killCalls).toBe(1);
    expect(() => handle.close()).not.toThrow();
    expect(fakeWorker.killCalls).toBe(1);
  });

  it('disposes page bridges on unexpected owner exit and settles closed despite cleanup failure', async () => {
    const reportError = vi.fn();
    vi.stubGlobal('reportError', reportError);
    archiveDisposeSpy.mockImplementation(() => {
      throw new Error('archive exit cleanup failed');
    });
    const { startWorkspaceOwner } = await importOwner();
    const handle = startWorkspaceOwner(ownerOptions());

    expect(() => fakeWorker.emit('exit', 137)).not.toThrow();
    await expect(handle.closed).resolves.toBe(137);
    expect(archiveDisposeSpy).toHaveBeenCalledOnce();
    expect(fileReadDisposeSpy).toHaveBeenCalledOnce();
    expect(reportError).toHaveBeenCalledWith(expect.any(AggregateError));
    expect(() => handle.close()).not.toThrow();
    expect(archiveDisposeSpy).toHaveBeenCalledOnce();
    expect(fileReadDisposeSpy).toHaveBeenCalledOnce();
  });

  it('queues generic raw messages until ready and exposes unclaimed owner messages', async () => {
    const { startWorkspaceOwner } = await importOwner();
    const handle = startWorkspaceOwner(ownerOptions());
    const request = { type: 'host:extension-request', value: 42 };

    const sent = handle.sendRawMessage(request);
    await Promise.resolve();
    expect(fakeWorker.sent).not.toContain(request);

    fakeWorker.emit('message', {
      type: 'rifty:workspace-owner-ready',
      port: handle.snapshotPort,
      backend: 'memory',
    });
    await sent;
    expect(fakeWorker.sent).toContain(request);

    const received: unknown[] = [];
    const unsubscribe = handle.onRawMessage((message) => received.push(message));
    const response = { type: 'host:extension-response', value: 43 };
    fakeWorker.emit('message', response);
    expect(received).toEqual([response]);
    unsubscribe();
    fakeWorker.emit('message', { type: 'host:extension-response', value: 44 });
    expect(received).toEqual([response]);
  });

  it('rejects a generic raw message when the live owner IPC channel refuses the send', async () => {
    const { startWorkspaceOwner } = await importOwner();
    const handle = startWorkspaceOwner(ownerOptions());
    fakeWorker.emit('message', {
      type: 'rifty:workspace-owner-ready',
      port: handle.snapshotPort,
      backend: 'memory',
    });
    fakeWorker.refuseSends = true;

    await expect(handle.sendRawMessage({ type: 'host:extension-request' })).rejects.toThrow(
      /fork-IPC channel refused raw message/,
    );
  });

  it("exposes the template's default port as bare PORT (Node idiom), separate from the bridge key", async () => {
    const { startWorkspaceOwner } = await importOwner();
    const template: ProjectSpec = { ...TEST_VITE_TEMPLATE, defaultPort: 4321 };

    const handle = startWorkspaceOwner(ownerOptions({ template }));

    const env = spawnedOptions(0).env;
    // node-server entries read process.env.PORT to bind their listen port.
    expect(env.PORT).toBe('4321');
    // The snapshot/nm BroadcastChannel key travels separately — never as PORT.
    expect(env.RIFTY_RFV_PORT).toBe(String(handle.snapshotPort));
    expect(env.RIFTY_RFV_PORT).not.toBe(env.PORT);
  });

  it('hands the kernel the exact host-injected owner worker URL', async () => {
    const { startWorkspaceOwner } = await importOwner();
    startWorkspaceOwner(ownerOptions());

    expect(spawnedOptions(0).entry).toEqual({ kind: 'url', url: 'boot.js' });
  });
});
