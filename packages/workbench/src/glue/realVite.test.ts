import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectSpec } from '../project-spec.ts';
import { TEST_PROJECT_CATALOG, TEST_VITE_TEMPLATE } from '../test-project.ts';
import type { OwnerBridgeKey } from './owner-bridge-key.ts';
import {
  type RealViteHost,
  type RealViteRuntime,
  type WorkspaceOwnerOptions,
  type WorkspaceOwnerProcessPort,
  type WorkspaceOwnerSpawnRequest,
  type WorkspaceOwnerSpawnResult,
  createRealViteForTesting,
} from './realVite.ts';
import type { WorkspaceArchiveBridge } from './workspace-archive-port.ts';
import type { WorkspaceFileReadBridge } from './workspace-file-read-port.ts';

const sendVfsWriteSpy = vi.fn();
const prepareOwnerSpy = vi.fn<(kernelWorkerUrl: string) => void>();
const spawnOwner = vi.fn<(request: WorkspaceOwnerSpawnRequest) => WorkspaceOwnerSpawnResult>();
const bridgeCrossRealmPreviewSpy = vi.fn<(port: number, scope?: string) => TestPreviewBridge>();
const registerPortSpy = vi.fn<(port: number, bridge: TestPreviewBridge) => void>();
const unregisterPortSpy = vi.fn<(port: number) => void>();
const mountPlaygroundPreviewBridgeSpy =
  vi.fn<
    (
      bridge: TestPreviewBridge,
      options: { readonly ownerToken: string; readonly ports: readonly number[] },
    ) => () => void
  >();
const tearSwBridgeSpy = vi.fn();
const previewDisposeSpy = vi.fn();
const archiveDisposeSpy = vi.fn();
const fileReadDisposeSpy = vi.fn();
const bridgeWorkspaceArchiveSpy = vi.fn<(key: OwnerBridgeKey) => WorkspaceArchiveBridge>();
const bridgeWorkspaceFileReadsSpy = vi.fn<(key: OwnerBridgeKey) => WorkspaceFileReadBridge>();

class FakeOwnerProcess implements WorkspaceOwnerProcessPort {
  alive = true;
  /** Simulate a refused (but not dead) IPC channel: send() returns false. */
  refuseSends = false;
  killCalls = 0;
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
    if (!this.alive || this.refuseSends) return false;
    this.sent.push(message);
    return true;
  }
  terminate(): boolean {
    this.killCalls += 1;
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

function spawnedOptions(call = 0): WorkspaceOwnerSpawnRequest {
  const args = spawnOwner.mock.calls[call];
  if (!args) throw new Error(`expected spawnOwner call #${call}`);
  return args[0];
}

interface TestPreviewBridge {
  dispose(): void;
}

let fakeWorker: FakeOwnerProcess;
let previewBridge: { dispose: typeof previewDisposeSpy };
let runtime: RealViteRuntime;

beforeEach(() => {
  vi.clearAllMocks();
  fakeWorker = new FakeOwnerProcess();
  spawnOwner.mockImplementation(() => ({ ok: true, process: fakeWorker }));
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
  const host: RealViteHost<TestPreviewBridge> = {
    prepareOwner: prepareOwnerSpy,
    spawnOwner,
    createArchiveBridge: (key) => bridgeWorkspaceArchiveSpy(key),
    createFileReadBridge: (key) => bridgeWorkspaceFileReadsSpy(key),
    sendFallbackWrite: (key, frame) => sendVfsWriteSpy(key, frame),
    createPreviewBridge: (port, scope) => bridgeCrossRealmPreviewSpy(port, scope),
    registerPreview: (port, bridge) => registerPortSpy(port, bridge),
    unregisterPreview: (port) => unregisterPortSpy(port),
    mountPreview: (bridge, options) => mountPlaygroundPreviewBridgeSpy(bridge, options),
  };
  runtime = createRealViteForTesting(host);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

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
    const handle = runtime.startWorkspaceOwner(ownerOptions());

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
    const handle = runtime.startWorkspaceOwner(ownerOptions());

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
    const teardown = runtime.wirePreviewBridge(5199, 'token-abc', '/p/');

    expect(bridgeCrossRealmPreviewSpy).toHaveBeenCalledWith(5199, '/p/');
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
    let failure: unknown;
    try {
      runtime.wirePreviewBridge(5199, 'token-abc');
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
    const teardown = runtime.wirePreviewBridge(5199, 'token-abc');

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
    const first = runtime.startWorkspaceOwner(ownerOptions());
    const second = runtime.startWorkspaceOwner(ownerOptions());

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
    spawnOwner.mockReturnValueOnce({
      ok: false,
      actualKind: 'same-realm',
      terminate: kill,
    });

    expect(() => runtime.startWorkspaceOwner(ownerOptions())).toThrow(/expected 'worker'/);
    expect(kill).toHaveBeenCalledOnce();
  });

  it('rolls back an already-spawned worker when page bridge construction fails', async () => {
    const bridgeError = new Error('file-read bridge construction failed');
    bridgeWorkspaceFileReadsSpy.mockImplementation(() => {
      throw bridgeError;
    });
    expect(() => runtime.startWorkspaceOwner(ownerOptions())).toThrow(bridgeError);
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
    const handle = runtime.startWorkspaceOwner(ownerOptions());

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
    const handle = runtime.startWorkspaceOwner(ownerOptions());

    expect(() => fakeWorker.die(137)).not.toThrow();
    await expect(handle.closed).resolves.toBe(137);
    expect(archiveDisposeSpy).toHaveBeenCalledOnce();
    expect(fileReadDisposeSpy).toHaveBeenCalledOnce();
    expect(reportError).toHaveBeenCalledWith(expect.any(AggregateError));
    expect(() => handle.close()).not.toThrow();
    expect(archiveDisposeSpy).toHaveBeenCalledOnce();
    expect(fileReadDisposeSpy).toHaveBeenCalledOnce();
  });

  it('queues generic raw messages until ready and exposes unclaimed owner messages', async () => {
    const handle = runtime.startWorkspaceOwner(ownerOptions());
    const request = { type: 'host:extension-request', value: 42 };

    const sent = handle.sendRawMessage(request);
    await Promise.resolve();
    expect(fakeWorker.sent).not.toContain(request);

    fakeWorker.emitMessage({
      type: 'rifty:workspace-owner-ready',
      port: handle.snapshotPort,
      backend: 'memory',
    });
    await sent;
    expect(fakeWorker.sent).toContain(request);

    const received: unknown[] = [];
    const unsubscribe = handle.onRawMessage((message) => received.push(message));
    const response = { type: 'host:extension-response', value: 43 };
    fakeWorker.emitMessage(response);
    expect(received).toEqual([response]);
    unsubscribe();
    fakeWorker.emitMessage({ type: 'host:extension-response', value: 44 });
    expect(received).toEqual([response]);
  });

  it('rejects a generic raw message when the live owner IPC channel refuses the send', async () => {
    const handle = runtime.startWorkspaceOwner(ownerOptions());
    fakeWorker.emitMessage({
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
    const template: ProjectSpec = { ...TEST_VITE_TEMPLATE, defaultPort: 4321 };

    const handle = runtime.startWorkspaceOwner(ownerOptions({ template }));

    const env = spawnedOptions(0).env;
    // node-server entries read process.env.PORT to bind their listen port.
    expect(env.PORT).toBe('4321');
    // The snapshot/nm BroadcastChannel key travels separately — never as PORT.
    expect(env.RIFTY_RFV_PORT).toBe(String(handle.snapshotPort));
    expect(env.RIFTY_RFV_PORT).not.toBe(env.PORT);
  });

  it('hands the kernel the exact host-injected owner worker URL', async () => {
    runtime.startWorkspaceOwner(ownerOptions());

    expect(prepareOwnerSpy).toHaveBeenCalledWith('kernel.js');
    expect(spawnedOptions(0).entryUrl).toBe('boot.js');
  });
});
