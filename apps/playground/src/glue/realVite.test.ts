import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectSpec } from '../templates/project-spec.ts';
import { defaultProjectSpec } from '../templates/registry.ts';

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

vi.mock('@riftydev/kernel', () => ({
  globalProcessManager: {
    spawnWorker: (...args: unknown[]) => spawnWorker(...args),
  },
  isSabIpcSupported: () => true,
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
  bridgeWorkspaceArchive: () => ({
    export: async () => '{}',
    import: async () => {},
    dispose: () => {},
  }),
}));

vi.mock('./workspace-file-read-port.ts', () => ({
  bridgeWorkspaceFileReads: () => ({
    readFileBytes: async () => new Uint8Array(),
    dispose: () => {},
  }),
}));

// `?worker&url` resolves to the BUNDLED worker script URL via the bundler; the
// mock pins that seam so the entry-url test proves the source hands the kernel
// this module's default export (a raw `new URL(...)` would bypass the mock).
vi.mock('../workers/real-vite-bootstrap.ts?worker&url', () => ({ default: 'boot.js' }));

/** Minimal faithful stand-in for the kernel `WorkerProcessHandle`. */
class FakeWorker extends EventEmitter {
  readonly kind = 'worker' as const;
  alive = true;
  /** Simulate a refused (but not dead) IPC channel: send() returns false. */
  refuseSends = false;
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
});

afterEach(() => {
  vi.clearAllMocks();
});

async function importOwner(): Promise<typeof import('./realVite.ts')> {
  return import('./realVite.ts');
}

async function captureUnhandledRejections(run: () => Promise<void>): Promise<unknown[]> {
  const errors: unknown[] = [];
  const onUnhandled = (error: unknown): void => {
    errors.push(error);
  };
  process.on('unhandledRejection', onUnhandled);
  try {
    await run();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  return errors;
}

describe('workspace owner page→owner VFS writes (ADR-0146: owner store is the source of truth)', () => {
  it('routes editor writes over kernel worker IPC while the owner channel accepts sends', async () => {
    const { startWorkspaceOwner } = await importOwner();
    const handle = startWorkspaceOwner();

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
    const handle = startWorkspaceOwner();

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

describe('workspace owner PTY mutation sends', () => {
  it('contains refused initial state-query sends after owner readiness', async () => {
    const { startWorkspaceOwner } = await importOwner();
    const handle = startWorkspaceOwner();
    fakeWorker.refuseSends = true;

    const unhandled = await captureUnhandledRejections(async () => {
      fakeWorker.emit('message', {
        type: 'rifty:workspace-owner-ready',
        port: handle.snapshotPort,
        ownerEpoch: 'owner-ready',
        treeRevision: 0,
      });
      await handle.ready;
    });
    fakeWorker.emit('exit', 0);
    await handle.closed;

    expect(unhandled).toEqual([]);
  });

  it('contains a refused explicit preview state-query send', async () => {
    const { startWorkspaceOwner } = await importOwner();
    const handle = startWorkspaceOwner();
    fakeWorker.emit('message', {
      type: 'rifty:workspace-owner-ready',
      port: handle.snapshotPort,
      ownerEpoch: 'owner-ready',
      treeRevision: 0,
    });
    await handle.ready;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    fakeWorker.refuseSends = true;

    const unhandled = await captureUnhandledRejections(async () => {
      handle.requestPreview();
    });
    fakeWorker.emit('exit', 0);
    await handle.closed;

    expect(unhandled).toEqual([]);
  });

  it('rejects dev config when kernel IPC refuses the send', async () => {
    const { startWorkspaceOwner } = await importOwner();
    const handle = startWorkspaceOwner();
    fakeWorker.emit('message', {
      type: 'rifty:workspace-owner-ready',
      port: handle.snapshotPort,
      ownerEpoch: 'owner-ready',
      treeRevision: 0,
    });
    await handle.ready;
    fakeWorker.refuseSends = true;
    const config = handle.setDevConfig({
      templateId: 'typescript',
      slug: 'refused',
      setup: 'instant',
    });
    const outcome = await Promise.race([
      config.then(
        () => 'resolved',
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      ),
      new Promise<string>((resolve) => setTimeout(() => resolve('pending'), 25)),
    ]);
    fakeWorker.emit('exit', 0);
    await handle.closed;

    expect(outcome).toMatch(/owner PTY send failed.*pty:dev-config/i);
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

  it('generates the preview owner token page-side, never threading it to the owner env', async () => {
    const { startWorkspaceOwner } = await importOwner();
    const first = startWorkspaceOwner();
    const second = startWorkspaceOwner();

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
  it("exposes the template's default port as bare PORT (Node idiom), separate from the bridge key", async () => {
    const { startWorkspaceOwner } = await importOwner();
    const template: ProjectSpec = { ...defaultProjectSpec(), defaultPort: 4321 };

    const handle = startWorkspaceOwner({ template });

    const env = spawnedOptions(0).env;
    // node-server entries read process.env.PORT to bind their listen port.
    expect(env.PORT).toBe('4321');
    // The snapshot/nm BroadcastChannel key travels separately — never as PORT.
    expect(env.RIFTY_RFV_PORT).toBe(String(handle.snapshotPort));
    expect(env.RIFTY_RFV_PORT).not.toBe(env.PORT);
  });

  it('hands the kernel the bundled bootstrap worker URL (?worker&url), not a raw module URL', async () => {
    const { startWorkspaceOwner } = await importOwner();
    startWorkspaceOwner();

    // 'boot.js' is this file's mock of `real-vite-bootstrap.ts?worker&url`; a
    // `new URL('../workers/…', import.meta.url)` entry would not hit the mock.
    expect(spawnedOptions(0).entry).toEqual({ kind: 'url', url: 'boot.js' });
  });
});
