import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Bug #4: on owner death the UI must leave 'running' AND post-exit writes must
// fail loudly instead of silently dropping through the snapshot-port fallback.
//
// We mock the transport boundaries only (kernel spawn, net registry, the two
// port bridges) and inject a fake worker EventEmitter, then drive the REAL
// `startWorkspaceOwner` wiring — the unit under test stays its exit/writeFile
// logic, not a re-implementation.

const sendVfsWriteSpy = vi.fn();
const spawnWorker = vi.fn();

vi.mock('@riftydev/kernel', () => ({
  globalProcessManager: {
    spawnWorker: (...args: unknown[]) => spawnWorker(...args),
  },
  isSabIpcSupported: () => true,
}));

vi.mock('@riftydev/net', () => ({
  bridgeCrossRealmPreview: () => ({ dispose: () => {} }),
  registerPort: () => {},
  unregisterPort: () => {},
}));

vi.mock('./vfs-write-port.ts', () => ({
  sendVfsWrite: (...args: unknown[]) => sendVfsWriteSpy(...args),
}));

vi.mock('./workspace-archive-port.ts', () => ({
  bridgeWorkspaceArchive: () => ({
    export: async () => '{}',
    import: async () => {},
    dispose: () => {},
  }),
}));

vi.mock('./preview-bridge-wiring.ts', () => ({
  mountPlaygroundPreviewBridge: () => () => {},
}));

// Worker URL imports (`?worker&url`) resolve to strings via the bundler; stub.
vi.mock('../workers/kernel-worker-entry.ts?worker&url', () => ({ default: 'kernel.js' }));
vi.mock('../workers/node-entry-bootstrap.ts?worker&url', () => ({ default: 'node.js' }));
vi.mock('../workers/real-vite-bootstrap.ts?worker&url', () => ({ default: 'boot.js' }));

/** Minimal faithful stand-in for the kernel `WorkerProcessHandle`. */
class FakeWorker extends EventEmitter {
  readonly kind = 'worker' as const;
  /** Flips to false once exited — mirrors Node `subprocess.send` post-close. */
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
  /** Simulate the worker dying: send() now returns false, exit fires. */
  die(code: number | null): void {
    this.alive = false;
    this.emit('exit', code);
  }
}

let fakeWorker: FakeWorker;

beforeEach(() => {
  vi.resetModules();
  sendVfsWriteSpy.mockClear();
  fakeWorker = new FakeWorker();
  spawnWorker.mockReturnValue(fakeWorker);
});

afterEach(() => {
  vi.clearAllMocks();
});

async function importOwner(): Promise<typeof import('./realVite.ts')> {
  return import('./realVite.ts');
}

describe('Bug #4 — owner death: stale running + silent write loss', () => {
  it('holds TS-LSP requests until the owner reports ready', async () => {
    const { startWorkspaceOwner } = await importOwner();
    const handle = startWorkspaceOwner();
    const request = {
      type: 'rifty:ts-lsp',
      request: { id: 1, type: 'ts:init', projectRoot: '/scratch' },
    };

    handle.sendTsLsp(request);
    await Promise.resolve();

    expect(
      fakeWorker.sent.some(
        (m) => !!m && typeof m === 'object' && (m as { type?: unknown }).type === 'rifty:ts-lsp',
      ),
    ).toBe(false);

    fakeWorker.emit('message', {
      type: 'rifty:workspace-owner-ready',
      port: handle.snapshotPort,
    });
    await handle.ready;
    await Promise.resolve();

    const tsFrame = fakeWorker.sent.find(
      (m) => !!m && typeof m === 'object' && (m as { type?: unknown }).type === 'rifty:ts-lsp',
    );
    expect(tsFrame).toBeDefined();
  });

  it('notifies dev-server listeners with a non-running frame on owner exit', async () => {
    const { startWorkspaceOwner } = await importOwner();
    const handle = startWorkspaceOwner();

    const frames: { status: string }[] = [];
    handle.onDevServer((frame) => frames.push(frame));

    fakeWorker.die(0);

    // The listener must hear a frame whose status is NOT 'running' so the UI
    // can leave its stale running pill.
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.at(-1)?.status).not.toBe('running');
  });

  it('throws on writeFile after the owner has exited (no silent drop)', async () => {
    const { startWorkspaceOwner } = await importOwner();
    const handle = startWorkspaceOwner();

    fakeWorker.die(137);

    expect(() => handle.writeFile('/workspace/a.txt', 'hi')).toThrow();
    // Must NOT have silently routed through the drop-prone snapshot fallback.
    expect(sendVfsWriteSpy).not.toHaveBeenCalled();
  });

  it('still writes through the live worker before exit', async () => {
    const { startWorkspaceOwner } = await importOwner();
    const handle = startWorkspaceOwner();

    handle.writeFile('/workspace/a.txt', 'hi');

    // Live path: goes over worker.send as a rifty:vfs-write envelope.
    const writeIpc = fakeWorker.sent.find(
      (m): m is { type: string } =>
        !!m && typeof m === 'object' && (m as { type?: unknown }).type === 'rifty:vfs-write',
    );
    expect(writeIpc).toBeDefined();
    expect(sendVfsWriteSpy).not.toHaveBeenCalled();
  });
});
