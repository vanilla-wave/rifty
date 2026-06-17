import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  type DevServerChildHandle,
  type DevServerChildSpawnParams,
  buildDevServerChildSpawnSpec,
  createOwnerChildDevServer,
} from './owner-child-dev-server.ts';

const params: DevServerChildSpawnParams = {
  templateId: 'm7-preview-sw',
  slug: 'm7-preview-sw',
  setup: 'instant',
  root: '/workspace',
  devPort: 5174,
  ownerToken: 'tok-123',
};

describe('buildDevServerChildSpawnSpec', () => {
  it('builds a serve:true remote-fs dev-server child spawn spec', () => {
    const spec = buildDevServerChildSpawnSpec(params, 'blob:dev-server-url');
    expect(spec.entry).toEqual({ kind: 'url', url: 'blob:dev-server-url' });
    expect(spec.argv).toEqual(['rifty', 'dev-server']);
    expect(spec.cwd).toBe('/workspace');
    expect(spec.serve).toBe(true); // long-lived server (vs P6a run-to-completion)
    expect(spec.env.RIFTY_REMOTE_FS).toBe('1');
    expect(spec.env.RIFTY_DEV_SERVER).toBe('1');
    expect(spec.env.RIFTY_RFV_TEMPLATE).toBe('m7-preview-sw');
    expect(spec.env.RIFTY_RFV_SLUG).toBe('m7-preview-sw');
    expect(spec.env.RIFTY_RFV_SETUP).toBe('instant');
    expect(spec.env.RIFTY_RFV_ROOT).toBe('/workspace');
    expect(spec.env.RIFTY_DEV_PORT).toBe('5174');
    expect(spec.env.PORT).toBe('5174'); // node-server entries bind process.env.PORT
    expect(spec.env.RIFTY_PREVIEW_OWNER_TOKEN).toBe('tok-123');
  });

  it('maps an undefined ownerToken to an empty string', () => {
    const spec = buildDevServerChildSpawnSpec({ ...params, ownerToken: undefined }, 'blob:x');
    expect(spec.env.RIFTY_PREVIEW_OWNER_TOKEN).toBe('');
  });
});

/** Minimal fake of the WorkerProcessHandle surface the driver needs. */
class FakeHandle extends EventEmitter implements DevServerChildHandle {
  kind = 'worker' as const;
  killed: string | null = null;
  sent: unknown[] = [];
  #out = new EventEmitter();
  #err = new EventEmitter();
  stdout() {
    return this.#out;
  }
  stderr() {
    return this.#err;
  }
  send(m: unknown) {
    this.sent.push(m);
    return true;
  }
  kill(sig?: string) {
    this.killed = sig ?? 'SIGTERM';
    queueMicrotask(() => this.emit('exit', null));
    return true;
  }
  emitStdout(s: string) {
    this.#out.emit('data', s);
  }
  emitMessage(m: unknown) {
    this.emit('message', m);
  }
}

describe('createOwnerChildDevServer', () => {
  it('resolves boot on rifty:dev-ready, streams logs, forwards file-changed, kills on stop', async () => {
    const fake = new FakeHandle();
    const logs: string[] = [];
    const snapshots: number[] = [];
    const driver = createOwnerChildDevServer('blob:dev-url', () => fake);
    const signal = new AbortController().signal;
    const bootPromise = driver.boot({
      signal,
      log: (c) => logs.push(c),
      params: {
        templateId: 'm7-preview-sw',
        slug: 'm7-preview-sw',
        setup: 'instant',
        root: '/workspace',
        devPort: 5174,
        ownerToken: 't',
      },
      onSnapshotDirty: () => snapshots.push(1),
    });
    fake.emitStdout('installing…\n');
    fake.emitMessage({ type: 'rifty:dev-snapshot' });
    fake.emitMessage({ type: 'rifty:dev-ready', port: 5174 });
    const handle = await bootPromise;
    expect(handle.port).toBe(5174);
    expect(logs.join('')).toContain('installing');
    expect(snapshots.length).toBe(1);
    handle.onFileChanged?.('/workspace/src/main.js');
    expect(fake.sent).toContainEqual({
      type: 'rifty:dev-file-changed',
      path: '/workspace/src/main.js',
    });
    await handle.stop();
    expect(fake.killed).toBe('SIGTERM');
  });

  // P6b regression (owner-persistence-reload): the child's install writes land in
  // the OWNER's OPFS write-through queue over fs.* RPC; the child's own flush is a
  // no-op. Boot MUST drain the owner queue (await `flush`) BEFORE resolving — so
  // the controller goes LIVE only once the owner store is durable, leaving the
  // queue empty for later shell writes (which then survive a reload).
  it('awaits flush on rifty:dev-ready before resolving boot', async () => {
    const fake = new FakeHandle();
    const driver = createOwnerChildDevServer('blob:dev-url', () => fake);
    let releaseFlush: (() => void) | undefined;
    let flushCalls = 0;
    const flush = () =>
      new Promise<void>((res) => {
        flushCalls += 1;
        releaseFlush = res;
      });
    const bootPromise = driver.boot({
      signal: new AbortController().signal,
      log: () => {},
      params: {
        templateId: 't',
        slug: 't',
        setup: 'instant',
        root: '/workspace',
        devPort: 5174,
        ownerToken: undefined,
      },
      onSnapshotDirty: () => {},
      flush,
    });
    let settled = false;
    void bootPromise.then(() => {
      settled = true;
    });
    fake.emitMessage({ type: 'rifty:dev-ready', port: 5174 });
    // flush invoked, but boot must NOT resolve until it settles.
    await Promise.resolve();
    await Promise.resolve();
    expect(flushCalls).toBe(1);
    expect(settled).toBe(false);
    releaseFlush?.();
    const handle = await bootPromise;
    expect(settled).toBe(true);
    expect(handle.port).toBe(5174);
  });

  it('tolerates an absent flush (optional)', async () => {
    const fake = new FakeHandle();
    const driver = createOwnerChildDevServer('blob:dev-url', () => fake);
    const bootPromise = driver.boot({
      signal: new AbortController().signal,
      log: () => {},
      params: {
        templateId: 't',
        slug: 't',
        setup: 'instant',
        root: '/workspace',
        devPort: 5174,
        ownerToken: undefined,
      },
      onSnapshotDirty: () => {},
      // no flush
    });
    fake.emitMessage({ type: 'rifty:dev-ready', port: 5174 });
    const handle = await bootPromise;
    expect(handle.port).toBe(5174);
  });

  it('rejects boot on rifty:dev-error', async () => {
    const fake = new FakeHandle();
    const driver = createOwnerChildDevServer('blob:dev-url', () => fake);
    const p = driver.boot({
      signal: new AbortController().signal,
      log: () => {},
      params: {
        templateId: 't',
        slug: 't',
        setup: 'instant',
        root: '/workspace',
        devPort: 5174,
        ownerToken: undefined,
      },
      onSnapshotDirty: () => {},
    });
    fake.emitMessage({ type: 'rifty:dev-error', message: 'install failed' });
    await expect(p).rejects.toThrow('install failed');
  });

  it('rejects boot if the child exits before ready', async () => {
    const fake = new FakeHandle();
    const driver = createOwnerChildDevServer('blob:dev-url', () => fake);
    const p = driver.boot({
      signal: new AbortController().signal,
      log: () => {},
      params: {
        templateId: 't',
        slug: 't',
        setup: 'instant',
        root: '/workspace',
        devPort: 5174,
        ownerToken: undefined,
      },
      onSnapshotDirty: () => {},
    });
    fake.emit('exit', 1);
    await expect(p).rejects.toThrow(/exited before listening/);
  });
});
