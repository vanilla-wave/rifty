import { EventEmitter } from 'node:events';
import type { TerminalResizeSource, TerminalSize } from '@riftydev/shell';
import { describe, expect, it } from 'vitest';
import {
  type DevServerChildHandle,
  type DevServerChildSpawnParams,
  buildDevServerChildSpawnSpec,
  createOwnerChildDevServer,
} from './owner-child-dev-server.ts';

const params: DevServerChildSpawnParams = {
  templateId: 'express-sqlite',
  root: '/workspace',
  devPort: 5174,
};

const NODE_WORKER_RUNTIME_ENV = {
  RIFTY_KERNEL_WORKER_URL: 'blob:kernel-url',
  RIFTY_NODE_ENTRY_WORKER_URL: 'blob:node-entry-url',
  RIFTY_SQLITE_WASM_URL: 'blob:sqlite-wasm',
  RIFTY_ESBUILD_WASM_URL: 'blob:esbuild-wasm',
};

describe('buildDevServerChildSpawnSpec', () => {
  it('builds a serve:true remote-fs dev-server child spawn spec', () => {
    const spec = buildDevServerChildSpawnSpec(
      params,
      'blob:dev-server-url',
      NODE_WORKER_RUNTIME_ENV,
    );
    expect(spec.entry).toEqual({ kind: 'url', url: 'blob:dev-server-url' });
    expect(spec.argv).toEqual(['rifty', 'dev-server']);
    expect(spec.cwd).toBe('/workspace');
    expect(spec.serve).toBe(true); // long-lived server (vs P6a run-to-completion)
    expect(spec.env.RIFTY_REMOTE_FS).toBe('1');
    expect(spec.env.RIFTY_RFV_TEMPLATE).toBe('express-sqlite');
    expect(spec.env.RIFTY_RFV_ROOT).toBe('/workspace');
    expect(spec.env.RIFTY_DEV_PORT).toBe('5174');
    expect(spec.env.PORT).toBe('5174'); // node-server entries bind process.env.PORT
  });

  it('threads recursive worker URLs for nested node-server workers', () => {
    const spec = buildDevServerChildSpawnSpec(
      params,
      'blob:dev-server-url',
      NODE_WORKER_RUNTIME_ENV,
    );

    expect(spec.env.RIFTY_KERNEL_WORKER_URL).toBe('blob:kernel-url');
    expect(spec.env.RIFTY_NODE_ENTRY_WORKER_URL).toBe('blob:node-entry-url');
    expect(spec.env.RIFTY_SQLITE_WASM_URL).toBe('blob:sqlite-wasm');
    expect(spec.env.RIFTY_ESBUILD_WASM_URL).toBe('blob:esbuild-wasm');
  });

  it('applies host metadata before operation-owned child controls', () => {
    const spec = buildDevServerChildSpawnSpec(
      { ...params, previewScope: 'expected-preview' },
      'blob:dev-server-url',
      {
        ...NODE_WORKER_RUNTIME_ENV,
        RIFTY_REMOTE_FS: 'poison-remote',
        RIFTY_RFV_TEMPLATE: 'poison-template',
        RIFTY_RFV_ROOT: 'poison-root',
        RIFTY_DEV_PORT: '9999',
        RIFTY_PREVIEW_SCOPE: 'poison-preview',
        NAPI_RS_FORCE_WASI: '0',
        PORT: '9999',
      },
    );

    expect(spec.env).toMatchObject({
      RIFTY_REMOTE_FS: '1',
      RIFTY_RFV_TEMPLATE: 'express-sqlite',
      RIFTY_RFV_ROOT: '/workspace',
      RIFTY_DEV_PORT: '5174',
      RIFTY_PREVIEW_SCOPE: 'expected-preview',
      NAPI_RS_FORCE_WASI: '1',
      PORT: '5174',
    });
  });

  it('forces the WASI path for napi-rs bindings — never native', () => {
    // rifty has no native bindings by construction (ADR-0051/0156).
    const spec = buildDevServerChildSpawnSpec(
      params,
      'blob:dev-server-url',
      NODE_WORKER_RUNTIME_ENV,
    );
    expect(spec.env.NAPI_RS_FORCE_WASI).toBe('1');
  });
});

/** Minimal fake of the WorkerProcessHandle surface the driver needs. */
class FakeHandle extends EventEmitter implements DevServerChildHandle {
  kind = 'worker' as const;
  killed: string | null = null;
  exited = false;
  resizes: TerminalSize[] = [];
  resizeBehavior: boolean | Error = true;
  #out = new EventEmitter();
  #err = new EventEmitter();
  stdout() {
    return this.#out;
  }
  stderr() {
    return this.#err;
  }
  resize(cols: number, rows: number) {
    this.resizes.push({ cols, rows });
    if (this.resizeBehavior instanceof Error) throw this.resizeBehavior;
    return this.resizeBehavior;
  }
  kill(sig?: string) {
    // Mirror the real WorkerHandle: kill() on an ALREADY-exited child returns
    // false and emits NO 'exit' (process-manager.ts kill()).
    if (this.exited) return false;
    this.killed = sig ?? 'SIGTERM';
    this.exited = true;
    queueMicrotask(() => this.emit('exit', null, 'SIGTERM'));
    return true;
  }
  emitStdout(s: string) {
    this.#out.emit('data', s);
  }
  emitMessage(m: unknown) {
    this.emit('message', m);
  }
  /** Simulate a post-ready child crash: mark exited + emit. */
  emitExit(code: number | null, signal: string | null = null) {
    this.exited = true;
    this.emit('exit', code, signal);
  }
}

class MutableTerminalResizeSource implements TerminalResizeSource {
  #size: TerminalSize;
  #listeners = new Set<(size: TerminalSize) => void>();

  constructor(cols: number, rows: number) {
    this.#size = { cols, rows };
  }

  current(): TerminalSize {
    return this.#size;
  }

  subscribe(listener: (size: TerminalSize) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  push(cols: number, rows: number): void {
    this.#size = { cols, rows };
    for (const listener of this.#listeners) listener(this.#size);
  }

  listenerCount(): number {
    return this.#listeners.size;
  }
}

describe('createOwnerChildDevServer', () => {
  it('forwards one TTY context from spawn through live resize and unsubscribes on stop', async () => {
    const fake = new FakeHandle();
    const terminal = new MutableTerminalResizeSource(100, 30);
    let capturedEnv: Readonly<Record<string, string>> | undefined;
    const driver = createOwnerChildDevServer('blob:dev-url', NODE_WORKER_RUNTIME_ENV, (spec) => {
      capturedEnv = spec.env;
      return fake;
    });
    const bootPromise = driver.boot({
      signal: new AbortController().signal,
      log: () => {},
      params: {
        ...params,
        isTTY: true,
        cols: 80,
        rows: 24,
        terminal,
      } as DevServerChildSpawnParams,
      onSnapshotDirty: () => {},
    });

    expect(capturedEnv).toMatchObject({
      RIFTY_STDIN_IS_TTY: '0',
      RIFTY_STDOUT_IS_TTY: '1',
      RIFTY_STDERR_IS_TTY: '1',
      RIFTY_TTY_COLS: '80',
      RIFTY_TTY_ROWS: '24',
    });
    expect(fake.resizes).toEqual([{ cols: 100, rows: 30 }]);
    expect(terminal.listenerCount()).toBe(1);

    terminal.push(120, 40);
    fake.emitMessage({ type: 'rifty:dev-ready', port: 5174 });
    const handle = await bootPromise;
    terminal.push(132, 43);
    expect(fake.resizes).toEqual([
      { cols: 100, rows: 30 },
      { cols: 120, rows: 40 },
      { cols: 132, rows: 43 },
    ]);

    await handle.stop();
    expect(terminal.listenerCount()).toBe(0);
    terminal.push(160, 50);
    expect(fake.resizes).toHaveLength(3);
  });

  it('unsubscribes live resize when the child exits before ready or crashes after ready', async () => {
    const first = new FakeHandle();
    const firstTerminal = new MutableTerminalResizeSource(90, 28);
    const firstDriver = createOwnerChildDevServer(
      'blob:dev-url',
      NODE_WORKER_RUNTIME_ENV,
      () => first,
    );
    const firstBoot = firstDriver.boot({
      signal: new AbortController().signal,
      log: () => {},
      params: { ...params, isTTY: true, terminal: firstTerminal } as DevServerChildSpawnParams,
      onSnapshotDirty: () => {},
    });
    expect(firstTerminal.listenerCount()).toBe(1);
    first.emitExit(1);
    await expect(firstBoot).rejects.toThrow(/exited before listening/i);
    expect(firstTerminal.listenerCount()).toBe(0);

    const second = new FakeHandle();
    const secondTerminal = new MutableTerminalResizeSource(91, 29);
    const secondDriver = createOwnerChildDevServer(
      'blob:dev-url',
      NODE_WORKER_RUNTIME_ENV,
      () => second,
    );
    const secondBoot = secondDriver.boot({
      signal: new AbortController().signal,
      log: () => {},
      params: { ...params, isTTY: true, terminal: secondTerminal } as DevServerChildSpawnParams,
      onSnapshotDirty: () => {},
    });
    second.emitMessage({ type: 'rifty:dev-ready', port: 5174 });
    const secondHandle = await secondBoot;
    const { failure } = secondHandle;
    expect(secondTerminal.listenerCount()).toBe(1);
    second.emitExit(null, 'SIGTERM');
    await expect(failure).resolves.toEqual({
      kind: 'exit',
      code: null,
      signal: 'SIGTERM',
      error: new Error('dev-server child exited after listening (code null, signal SIGTERM)'),
    });
    expect(secondTerminal.listenerCount()).toBe(0);
    secondTerminal.push(140, 45);
    expect(second.resizes).toEqual([{ cols: 91, rows: 29 }]);
  });

  it.each([
    ['closed resize control', false, /resize control is closed/i],
    ['throwing resize transport', new Error('resize transport failed'), /resize transport failed/i],
  ] as const)(
    'reports a post-ready %s through the lifecycle channel and the live resize call',
    async (_case, resizeBehavior, message) => {
      const fake = new FakeHandle();
      const terminal = new MutableTerminalResizeSource(95, 33);
      const driver = createOwnerChildDevServer('blob:dev-url', NODE_WORKER_RUNTIME_ENV, () => fake);
      const boot = driver.boot({
        signal: new AbortController().signal,
        log: () => {},
        params: { ...params, isTTY: true, terminal },
        onSnapshotDirty: () => {},
      });
      fake.emitMessage({ type: 'rifty:dev-ready', port: 5174 });
      const handle = await boot;
      const { failure } = handle;
      fake.resizeBehavior = resizeBehavior;

      try {
        expect(() => terminal.push(140, 45)).toThrow(message);
        const reported = await failure;
        expect(reported.kind).toBe('error');
        expect(reported.error.message).toMatch(message);
        expect(fake.killed).toBe('SIGTERM');
        expect(terminal.listenerCount()).toBe(0);
      } finally {
        await handle.stop();
      }
    },
  );

  it('reports a post-ready dev-error through the same lifecycle channel', async () => {
    const fake = new FakeHandle();
    const driver = createOwnerChildDevServer('blob:dev-url', NODE_WORKER_RUNTIME_ENV, () => fake);
    const boot = driver.boot({
      signal: new AbortController().signal,
      log: () => {},
      params,
      onSnapshotDirty: () => {},
    });
    fake.emitMessage({ type: 'rifty:dev-ready', port: 5174 });
    const handle = await boot;
    const { failure } = handle;

    try {
      fake.emitMessage({ type: 'rifty:dev-error', message: 'post-ready dev failure' });
      await expect(failure).resolves.toEqual({
        kind: 'error',
        error: new Error('post-ready dev failure'),
      });
      expect(fake.killed).toBe('SIGTERM');
    } finally {
      await handle.stop();
    }
  });

  it('unbinds resize immediately on pre-ready abort and never binds a pre-aborted run', async () => {
    const first = new FakeHandle();
    const firstTerminal = new MutableTerminalResizeSource(92, 30);
    const firstAbort = new AbortController();
    const firstDriver = createOwnerChildDevServer(
      'blob:dev-url',
      NODE_WORKER_RUNTIME_ENV,
      () => first,
    );
    const firstBoot = firstDriver.boot({
      signal: firstAbort.signal,
      log: () => {},
      params: { ...params, isTTY: true, terminal: firstTerminal },
      onSnapshotDirty: () => {},
    });
    expect(first.resizes).toEqual([{ cols: 92, rows: 30 }]);
    expect(firstTerminal.listenerCount()).toBe(1);

    firstAbort.abort();
    expect(firstTerminal.listenerCount()).toBe(0);
    firstTerminal.push(140, 45);
    expect(first.resizes).toHaveLength(1);
    expect(first.killed).toBe('SIGTERM');
    await expect(firstBoot).rejects.toMatchObject({
      exit: { code: null, signal: 'SIGTERM' },
    });

    const second = new FakeHandle();
    const secondTerminal = new MutableTerminalResizeSource(93, 31);
    const preAborted = new AbortController();
    preAborted.abort();
    const secondDriver = createOwnerChildDevServer(
      'blob:dev-url',
      NODE_WORKER_RUNTIME_ENV,
      () => second,
    );
    const secondBoot = secondDriver.boot({
      signal: preAborted.signal,
      log: () => {},
      params: { ...params, isTTY: true, terminal: secondTerminal },
      onSnapshotDirty: () => {},
    });
    expect(second.resizes).toEqual([]);
    expect(secondTerminal.listenerCount()).toBe(0);
    expect(second.killed).toBe('SIGTERM');
    await expect(secondBoot).rejects.toMatchObject({
      exit: { code: null, signal: 'SIGTERM' },
    });
  });

  it('resolves boot on rifty:dev-ready, streams logs, and kills on stop', async () => {
    const fake = new FakeHandle();
    const logs: string[] = [];
    const snapshots: number[] = [];
    const driver = createOwnerChildDevServer('blob:dev-url', NODE_WORKER_RUNTIME_ENV, () => fake);
    const signal = new AbortController().signal;
    const bootPromise = driver.boot({
      signal,
      log: (c) => logs.push(c),
      params: {
        templateId: 'express-sqlite',
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
    const firstStop = handle.stop();
    const secondStop = handle.stop();
    expect(secondStop).toBe(firstStop);
    await expect(firstStop).resolves.toEqual({ code: null, signal: 'SIGTERM' });
    expect(fake.killed).toBe('SIGTERM');
  });

  it('forwards post-ready rifty:dev-ports to onPortsChanged; pre-ready frames are ignored', async () => {
    const fake = new FakeHandle();
    const driver = createOwnerChildDevServer('blob:dev-url', NODE_WORKER_RUNTIME_ENV, () => fake);
    const changes: Array<readonly number[]> = [];
    const bootPromise = driver.boot({
      signal: new AbortController().signal,
      log: () => {},
      params: {
        templateId: 'express-sqlite',
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
    const driver = createOwnerChildDevServer('blob:dev-url', NODE_WORKER_RUNTIME_ENV, () => fake);
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
    const driver = createOwnerChildDevServer('blob:dev-url', NODE_WORKER_RUNTIME_ENV, () => fake);
    const bootPromise = driver.boot({
      signal: new AbortController().signal,
      log: () => {},
      params: {
        templateId: 't',
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
    const terminal = new MutableTerminalResizeSource(94, 32);
    const driver = createOwnerChildDevServer('blob:dev-url', NODE_WORKER_RUNTIME_ENV, () => fake);
    const p = driver.boot({
      signal: new AbortController().signal,
      log: () => {},
      params: {
        templateId: 't',
        root: '/workspace',
        devPort: 5174,
        isTTY: true,
        terminal,
      },
      onSnapshotDirty: () => {},
    });
    expect(terminal.listenerCount()).toBe(1);
    fake.emitMessage({ type: 'rifty:dev-error', message: 'install failed' });
    await expect(p).rejects.toThrow('install failed');
    expect(terminal.listenerCount()).toBe(0);
    expect(fake.killed).toBe('SIGTERM');
    terminal.push(150, 48);
    expect(fake.resizes).toEqual([{ cols: 94, rows: 32 }]);
  });

  it('rejects boot if the child exits before ready', async () => {
    const fake = new FakeHandle();
    const driver = createOwnerChildDevServer('blob:dev-url', NODE_WORKER_RUNTIME_ENV, () => fake);
    const p = driver.boot({
      signal: new AbortController().signal,
      log: () => {},
      params: {
        templateId: 't',
        root: '/workspace',
        devPort: 5174,
      },
      onSnapshotDirty: () => {},
    });
    fake.emitExit(1);
    await expect(p).rejects.toMatchObject({
      message: expect.stringMatching(/exited before listening/),
      exit: { code: 1, signal: null },
    });
  });

  it('kills and exactly settles an abort before ready without a fake ready message', async () => {
    const fake = new FakeHandle();
    const abort = new AbortController();
    const driver = createOwnerChildDevServer('blob:dev-url', NODE_WORKER_RUNTIME_ENV, () => fake);
    const boot = driver.boot({
      signal: abort.signal,
      log: () => {},
      params,
      onSnapshotDirty: () => {},
    });

    try {
      abort.abort();
      expect(fake.killed).toBe('SIGTERM');
      await expect(boot).rejects.toMatchObject({
        exit: { code: null, signal: 'SIGTERM' },
      });
    } finally {
      if (!fake.exited) {
        fake.emitMessage({ type: 'rifty:dev-ready', port: 5174 });
        await (await boot).stop();
      }
    }
  });

  it('kills and exactly settles a pre-aborted boot', async () => {
    const fake = new FakeHandle();
    const abort = new AbortController();
    abort.abort();
    const driver = createOwnerChildDevServer('blob:dev-url', NODE_WORKER_RUNTIME_ENV, () => fake);
    const boot = driver.boot({
      signal: abort.signal,
      log: () => {},
      params,
      onSnapshotDirty: () => {},
    });

    try {
      expect(fake.killed).toBe('SIGTERM');
      await expect(boot).rejects.toMatchObject({
        exit: { code: null, signal: 'SIGTERM' },
      });
    } finally {
      if (!fake.exited) {
        fake.emitMessage({ type: 'rifty:dev-ready', port: 5174 });
        await (await boot).stop();
      }
    }
  });

  it.each([
    [0, 'SIGTERM'],
    [null, null],
    [null, 'SIGKILL'],
  ] as const)('rejects an invalid physical exit pair (%s, %s)', async (code, signal) => {
    const fake = new FakeHandle();
    const driver = createOwnerChildDevServer('blob:dev-url', NODE_WORKER_RUNTIME_ENV, () => fake);
    const boot = driver.boot({
      signal: new AbortController().signal,
      log: () => {},
      params,
      onSnapshotDirty: () => {},
    });

    fake.emitExit(code, signal);

    await expect(boot).rejects.toThrow(/invalid exit/i);
  });

  // Regression (P6b review): a post-ready child crash sets the handle's exitCode,
  // so the real WorkerHandle.kill() returns false and emits NO 'exit'. stop() must
  // still resolve — else Ctrl-C recovery after a mid-run crash hangs the dev-run.
  it('stop() does not hang when the child already exited (post-ready crash)', async () => {
    const fake = new FakeHandle();
    const driver = createOwnerChildDevServer('blob:dev-url', NODE_WORKER_RUNTIME_ENV, () => fake);
    const bootPromise = driver.boot({
      signal: new AbortController().signal,
      log: () => {},
      params: { templateId: 't', root: '/workspace', devPort: 5174 },
      onSnapshotDirty: () => {},
    });
    fake.emitMessage({ type: 'rifty:dev-ready', port: 5174 });
    const handle = await bootPromise;
    fake.emitExit(1); // child crashes AFTER ready
    await handle.stop(); // would hang forever without the kill()-returns-false guard
    expect(fake.killed).toBeNull(); // kill() short-circuited on the already-exited handle
  });
});
