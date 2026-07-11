import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { TEST_VITE_TEMPLATE } from '../test-project.ts';
import {
  type DevServerChildHandle,
  type DevServerChildSpawnParams,
  buildDevServerChildSpawnSpec,
  createOwnerChildDevServer,
} from './owner-child-dev-server.ts';

const params: DevServerChildSpawnParams = {
  projectSpec: TEST_VITE_TEMPLATE,
  slug: 'm7-preview-sw',
  setup: 'instant',
  root: '/workspace',
  devPort: 5174,
};

const workerConfig = {
  kernelWorkerUrl: 'blob:kernel-url',
  nodeEntryWorkerUrl: 'blob:node-entry-url',
  sqliteWasmUrl: 'blob:sqlite-url',
  esbuildWasmUrl: 'blob:esbuild-url',
};

describe('buildDevServerChildSpawnSpec', () => {
  it('builds a serve:true remote-fs dev-server child spawn spec', () => {
    const spec = buildDevServerChildSpawnSpec(params, 'blob:dev-server-url', workerConfig);
    expect(spec.entry).toEqual({ kind: 'url', url: 'blob:dev-server-url' });
    expect(spec.argv).toEqual(['rifty', 'dev-server']);
    expect(spec.cwd).toBe('/workspace');
    expect(spec.serve).toBe(true); // long-lived server (vs P6a run-to-completion)
    expect(spec.env.RIFTY_REMOTE_FS).toBe('1');
    expect(spec.env.RIFTY_RFV_PROJECT_SPEC).toBe(JSON.stringify(TEST_VITE_TEMPLATE));
    expect(spec.env.RIFTY_RFV_SLUG).toBe('m7-preview-sw');
    expect(spec.env.RIFTY_RFV_SETUP).toBe('instant');
    expect(spec.env.RIFTY_RFV_ROOT).toBe('/workspace');
    expect(spec.env.RIFTY_DEV_PORT).toBe('5174');
    expect(spec.env.PORT).toBe('5174'); // node-server entries bind process.env.PORT
  });

  it('threads recursive worker URLs so Vite 8 can spawn Rolldown workers', () => {
    const spec = buildDevServerChildSpawnSpec(params, 'blob:dev-server-url', workerConfig);

    expect(spec.env.RIFTY_KERNEL_WORKER_URL).toBe('blob:kernel-url');
    expect(spec.env.RIFTY_NODE_ENTRY_WORKER_URL).toBe('blob:node-entry-url');
    expect(spec.env.RIFTY_SQLITE_WASM_URL).toBe('blob:sqlite-url');
    expect(spec.env.RIFTY_ESBUILD_WASM_URL).toBe('blob:esbuild-url');
  });

  it('forces the WASI path for napi-rs bindings (Rolldown) — never native', () => {
    // Rolldown's napi-rs loader tries every native `@rolldown/binding-<platform>`
    // (all ENATIVEUNSUPPORTED in rifty), then SWALLOWS its wasm32-wasi load error
    // unless NAPI_RS_FORCE_WASI is set — surfacing only "Cannot find native
    // binding". rifty has no native bindings by construction (ADR-0051/0156).
    const spec = buildDevServerChildSpawnSpec(params, 'blob:dev-server-url', workerConfig);
    expect(spec.env.NAPI_RS_FORCE_WASI).toBe('1');
  });
});

/** Minimal fake of the WorkerProcessHandle surface the driver needs. */
class FakeHandle extends EventEmitter implements DevServerChildHandle {
  kind = 'worker' as const;
  killed: string | null = null;
  exited = false;
  sent: unknown[] = [];
  resizes: Array<{ cols: number; rows: number }> = [];
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
  resize(cols: number, rows: number) {
    this.resizes.push({ cols, rows });
    return true;
  }
  kill(sig?: string) {
    // Mirror the real WorkerHandle: kill() on an ALREADY-exited child returns
    // false and emits NO 'exit' (process-manager.ts kill()).
    if (this.exited) return false;
    this.killed = sig ?? 'SIGTERM';
    this.exited = true;
    queueMicrotask(() => this.emit('exit', null));
    return true;
  }
  emitStdout(s: string) {
    this.#out.emit('data', s);
  }
  emitMessage(m: unknown) {
    this.emit('message', m);
  }
  /** Simulate a post-ready child crash: mark exited + emit. */
  emitExit(code?: unknown) {
    this.exited = true;
    this.emit('exit', code);
  }
}

describe('createOwnerChildDevServer', () => {
  it('seeds terminal dimensions and forwards live resize until the child stops', async () => {
    const fake = new FakeHandle();
    let capturedSpec: { readonly env: Readonly<Record<string, string>> } | undefined;
    const driver = createOwnerChildDevServer('blob:dev-url', workerConfig, (spec) => {
      capturedSpec = spec;
      return fake;
    });
    let size = { cols: 100, rows: 30 };
    const listeners = new Set<(next: { cols: number; rows: number }) => void>();
    const boot = driver.boot({
      signal: new AbortController().signal,
      log: () => {},
      params: { ...params },
      terminal: {
        current: () => size,
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      onSnapshotDirty: () => {},
    });
    expect(capturedSpec).toMatchObject({
      env: { RIFTY_TTY_COLS: '100', RIFTY_TTY_ROWS: '30' },
    });

    size = { cols: 132, rows: 43 };
    for (const listener of listeners) listener(size);
    expect(fake.resizes).toEqual([{ cols: 132, rows: 43 }]);

    fake.emitMessage({ type: 'rifty:dev-ready', port: 5174 });
    const handle = await boot;
    await handle.stop();
    size = { cols: 140, rows: 50 };
    for (const listener of listeners) listener(size);
    expect(fake.resizes).toHaveLength(1);
  });

  it('resolves boot on rifty:dev-ready, streams logs, forwards file-changed, kills on stop', async () => {
    const fake = new FakeHandle();
    const logs: string[] = [];
    const snapshots: number[] = [];
    const driver = createOwnerChildDevServer('blob:dev-url', workerConfig, () => fake);
    const signal = new AbortController().signal;
    const bootPromise = driver.boot({
      signal,
      log: (c) => logs.push(c),
      params: {
        projectSpec: TEST_VITE_TEMPLATE,
        slug: 'm7-preview-sw',
        setup: 'instant',
        root: '/workspace',
        devPort: 5174,
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

  it('forwards post-ready rifty:dev-ports to onPortsChanged; pre-ready frames are ignored', async () => {
    const fake = new FakeHandle();
    const driver = createOwnerChildDevServer('blob:dev-url', workerConfig, () => fake);
    const changes: Array<readonly number[]> = [];
    const bootPromise = driver.boot({
      signal: new AbortController().signal,
      log: () => {},
      params: {
        projectSpec: TEST_VITE_TEMPLATE,
        slug: 'm7-preview-sw',
        setup: 'instant',
        root: '/workspace',
        devPort: 5174,
      },
      onSnapshotDirty: () => {},
      onPortsChanged: (ports) => changes.push(ports),
    });
    // Pre-ready: boot resolution owns the first port — port frames are ignored.
    fake.emitMessage({ type: 'rifty:dev-ports', ports: [5174] });
    fake.emitMessage({ type: 'rifty:dev-ready', port: 5174 });
    await bootPromise;
    // Post-ready: the entry closed its server → the pill must leave running.
    fake.emitMessage({ type: 'rifty:dev-ports', ports: [] });
    fake.emitMessage({ type: 'rifty:dev-ports', ports: [5175] });
    expect(changes).toEqual([[], [5175]]);
  });

  // P6b regression (owner-persistence-reload): the child's install writes land in
  // the OWNER's OPFS write-through queue over fs.* RPC; the child's own flush is a
  // no-op. Boot MUST drain the owner queue (await `flush`) BEFORE resolving — so
  // the controller goes LIVE only once the owner store is durable, leaving the
  // queue empty for later shell writes (which then survive a reload).
  it('awaits flush on rifty:dev-ready before resolving boot', async () => {
    const fake = new FakeHandle();
    const driver = createOwnerChildDevServer('blob:dev-url', workerConfig, () => fake);
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
        projectSpec: TEST_VITE_TEMPLATE,
        slug: 't',
        setup: 'instant',
        root: '/workspace',
        devPort: 5174,
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
    const driver = createOwnerChildDevServer('blob:dev-url', workerConfig, () => fake);
    const bootPromise = driver.boot({
      signal: new AbortController().signal,
      log: () => {},
      params: {
        projectSpec: TEST_VITE_TEMPLATE,
        slug: 't',
        setup: 'instant',
        root: '/workspace',
        devPort: 5174,
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
    const driver = createOwnerChildDevServer('blob:dev-url', workerConfig, () => fake);
    const p = driver.boot({
      signal: new AbortController().signal,
      log: () => {},
      params: {
        projectSpec: TEST_VITE_TEMPLATE,
        slug: 't',
        setup: 'instant',
        root: '/workspace',
        devPort: 5174,
      },
      onSnapshotDirty: () => {},
    });
    fake.emitMessage({ type: 'rifty:dev-error', message: 'install failed' });
    await expect(p).rejects.toThrow('install failed');
  });

  it('rejects boot if the child exits before ready', async () => {
    const fake = new FakeHandle();
    const driver = createOwnerChildDevServer('blob:dev-url', workerConfig, () => fake);
    const p = driver.boot({
      signal: new AbortController().signal,
      log: () => {},
      params: {
        projectSpec: TEST_VITE_TEMPLATE,
        slug: 't',
        setup: 'instant',
        root: '/workspace',
        devPort: 5174,
      },
      onSnapshotDirty: () => {},
    });
    fake.emit('exit', 1);
    await expect(p).rejects.toThrow(/exited before listening/);
  });

  // Regression (P6b review): a post-ready child crash sets the handle's exitCode,
  // so the real WorkerHandle.kill() returns false and emits NO 'exit'. stop() must
  // still resolve — else Ctrl-C recovery after a mid-run crash hangs the dev-run.
  it('stop() does not hang when the child already exited (post-ready crash)', async () => {
    const fake = new FakeHandle();
    const driver = createOwnerChildDevServer('blob:dev-url', workerConfig, () => fake);
    const bootPromise = driver.boot({
      signal: new AbortController().signal,
      log: () => {},
      params: {
        projectSpec: TEST_VITE_TEMPLATE,
        slug: 't',
        setup: 'instant',
        root: '/workspace',
        devPort: 5174,
      },
      onSnapshotDirty: () => {},
    });
    fake.emitMessage({ type: 'rifty:dev-ready', port: 5174 });
    const handle = await bootPromise;
    fake.emitExit(1); // child crashes AFTER ready
    await handle.stop(); // would hang forever without the kill()-returns-false guard
    expect(fake.killed).toBeNull(); // kill() short-circuited on the already-exited handle
  });
});
