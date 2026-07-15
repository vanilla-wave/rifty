import { globalProcessManager } from '@riftydev/kernel';
import { RegistryClient } from '@riftydev/npm-client';
import { createMemoryFs, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OwnerToPageFrame } from '../glue/pty-protocol.ts';
import { SyncMirrorVfs } from '../glue/sync-mirror-vfs.ts';
import type { BootstrapConfig } from '../templates/project-spec.ts';
import { type OwnerPackageConfig, createOwnerPackageState } from './owner-package-state.ts';
import { createOwnerVfsAuthorityComposition } from './owner-vfs-authority.ts';
import {
  type WorkbenchProjectRuntime,
  createWorkbenchProjectRuntime,
} from './workbench-project-runtime.ts';

const ROOT = '/.rifty/workbench/v1/projects/project-a/tree';
const PACKAGE_JSON = `${JSON.stringify({
  name: 'workbench-project-a',
  version: '1.0.0',
  scripts: { where: 'pwd', dev: 'vite' },
  devDependencies: { vite: '8.0.16' },
})}\n`;

const bootstrapConfig: BootstrapConfig = {
  runtime: 'vite',
  root: ROOT,
  port: 5173,
  entryPath: `${ROOT}/src/main.js`,
  packageName: 'workbench-project-a',
  packageVersion: '1.0.0',
  installDeps: { vite: '8.0.16' },
  packageJson: PACKAGE_JSON,
  seedFiles: {},
};

const packageConfig: OwnerPackageConfig = {
  cfg: bootstrapConfig,
  templateId: 'workbench-vite',
  slug: 'project-a',
  fromScratch: true,
};

interface BoundaryWorker {
  readonly handle: ReturnType<typeof globalProcessManager.spawnWorker>;
  readonly spec: () => Parameters<typeof globalProcessManager.spawnWorker>[1] | null;
  readonly killedWith: () => string | null;
  emitMessage(message: unknown): void;
  emitExit(code: number | null, signal?: string | null): void;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function settledOr<T, TPending>(promise: Promise<T>, pending: TPending): Promise<T | TPending> {
  return Promise.race([
    promise,
    new Promise<TPending>((resolve) => setTimeout(resolve, 30, pending)),
  ]);
}

function boundaryWorker(): BoundaryWorker {
  let capturedSpec: Parameters<typeof globalProcessManager.spawnWorker>[1] | null = null;
  let killedWith: string | null = null;
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const stdinListeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const writer = {
    write(_chunk: unknown, callback?: (error?: Error | null) => void) {
      callback?.();
      return true;
    },
    end() {
      queueMicrotask(() => {
        for (const listener of stdinListeners.get('finish') ?? []) listener();
      });
      return writer;
    },
    once(event: string, listener: (...args: unknown[]) => void) {
      const wrapped = (...args: unknown[]): void => {
        writer.removeListener(event, wrapped);
        listener(...args);
      };
      const current = stdinListeners.get(event) ?? [];
      current.push(wrapped);
      stdinListeners.set(event, current);
      return writer;
    },
    removeListener(event: string, listener: (...args: unknown[]) => void) {
      const current = stdinListeners.get(event) ?? [];
      stdinListeners.set(
        event,
        current.filter((candidate) => candidate !== listener),
      );
      return writer;
    },
  };
  const rawHandle = {
    kind: 'worker' as const,
    pid: 101,
    ppid: 1,
    command: 'vite',
    cwd: ROOT,
    exitCode: null,
    signalCode: null,
    ports: {},
    stdout: () => ({ on: () => undefined }),
    stderr: () => ({ on: () => undefined }),
    stdin: () => writer,
    on(event: string, listener: (...args: unknown[]) => void) {
      const current = listeners.get(event) ?? [];
      current.push(listener);
      listeners.set(event, current);
      return rawHandle;
    },
    send: () => true,
    resize: () => true,
    kill(signal = 'SIGTERM') {
      killedWith = signal;
      return true;
    },
    disconnect: () => undefined,
    setCwd: () => undefined,
  };
  const handle = rawHandle as unknown as ReturnType<typeof globalProcessManager.spawnWorker>;
  vi.spyOn(globalProcessManager, 'spawnWorker').mockImplementation((_command, spec) => {
    capturedSpec = spec;
    return handle;
  });
  return {
    handle,
    spec: () => capturedSpec,
    killedWith: () => killedWith,
    emitMessage(message) {
      for (const listener of listeners.get('message') ?? []) listener(message);
    },
    emitExit(code, signal = null) {
      for (const listener of listeners.get('exit') ?? []) listener(code, signal);
    },
  };
}

function harness(
  onSend?: (frame: OwnerToPageFrame, runtime: () => WorkbenchProjectRuntime) => void,
) {
  const pair = createMemoryFs();
  const { authority, installStampClaims } = createOwnerVfsAuthorityComposition(pair.fsSync, {
    ownerEpoch: 'workbench-project-runtime-test',
    initialRoots: ['/'],
  });
  setSyncMirror(authority, { async: pair.vfs });
  authority.mkdirSync(`${ROOT}/src`, { recursive: true });
  authority.mkdirSync(`${ROOT}/node_modules/.bin`, { recursive: true });
  authority.writeFileSync(`${ROOT}/package.json`, new TextEncoder().encode(PACKAGE_JSON));
  authority.writeFileSync(
    `${ROOT}/node_modules/.bin/vite`,
    new TextEncoder().encode('#!/usr/bin/env node\n'),
  );
  const packageState = createOwnerPackageState({
    initial: packageConfig,
    vfs: new SyncMirrorVfs(),
    fsSync: authority,
    installStampClaims,
    flush: () => authority.flush(),
    nodeWorkerRuntimeEnv: { RIFTY_KERNEL_WORKER_URL: 'https://example.test/kernel.js' },
    log: () => {},
    registry: new RegistryClient({
      baseUrl: 'https://example.test/registry',
      fetch: async () => new Response('', { status: 599 }),
    }),
    resolverUrl: () => undefined,
    resolverBundleBaseUrl: () => undefined,
    resolverPin: () => undefined,
  });
  const frames: OwnerToPageFrame[] = [];
  const runtimeRef: { current?: WorkbenchProjectRuntime } = {};
  const runtime = createWorkbenchProjectRuntime({
    projectRoot: ROOT,
    packageConfig,
    authority,
    packageState,
    nodeEntryWorkerUrl: 'https://example.test/node-entry.js',
    nodeWorkerRuntimeEnv: { RIFTY_KERNEL_WORKER_URL: 'https://example.test/kernel.js' },
    send: (frame) => {
      frames.push(frame);
      onSend?.(frame, () => {
        const current = runtimeRef.current;
        if (current === undefined) throw new Error('runtime callback fired during construction');
        return current;
      });
    },
  });
  runtimeRef.current = runtime;
  return { authority, frames, packageState, runtime };
}

afterEach(() => {
  vi.restoreAllMocks();
  resetSyncMirror();
});

describe('Workbench project runtime', () => {
  it('uses owner-rooted Shells and actor-minted preview provenance despite forged guest env', async () => {
    const worker = boundaryWorker();
    const h = harness();
    h.runtime.handlePtyFrame({
      type: 'pty:open',
      sid: 'terminal-a',
      cwd: '/missing-restored-cwd',
      env: {
        RIFTY_INTERNAL_PTY_SID: 'terminal-forged',
        RIFTY_PREVIEW_SCOPE: 'scope-forged',
        RIFTY_VITE_CLI_MODE: 'build',
        USER_FLAG: 'preserved',
      },
    });

    const running = Promise.resolve(
      h.runtime.handlePtyFrame({
        type: 'pty:exec',
        sid: 'terminal-a',
        rid: 'run-a',
        line: 'vite --port 5173',
        cols: 90,
        rows: 30,
        isTTY: true,
      }),
    );
    await vi.waitFor(() => expect(worker.spec()).not.toBeNull());

    expect(worker.spec()).toMatchObject({
      cwd: ROOT,
      argv: ['rifty', `${ROOT}/node_modules/.bin/vite`, '--port', '5173'],
      env: expect.objectContaining({
        USER_FLAG: 'preserved',
        RIFTY_VITE_CLI_MODE: 'dev',
      }),
    });
    expect(worker.spec()?.env.RIFTY_INTERNAL_PTY_SID).toBeUndefined();
    expect(worker.spec()?.env.RIFTY_PREVIEW_SCOPE).not.toBe('scope-forged');

    worker.emitMessage({
      type: 'rifty:node-listening',
      ports: [5173],
      previewScope: 'scope-a',
    });
    const preview = h.frames
      .filter(
        (frame): frame is Extract<OwnerToPageFrame, { type: 'pty:preview' }> =>
          frame.type === 'pty:preview',
      )
      .at(-1);
    expect(preview?.ports).toEqual([
      expect.objectContaining({
        port: 5173,
        source: 'node',
        ptySid: 'terminal-a',
        ptyRid: 'run-a',
        previewScope: 'scope-a',
      }),
    ]);

    const closing = h.runtime.close();
    expect(h.runtime.close()).toBe(closing);
    expect(worker.killedWith()).toBe('SIGTERM');
    expect(h.frames.slice(-2)).toEqual([
      { type: 'pty:preview', ports: [] },
      { type: 'pty:dev-server', status: 'stopped' },
    ]);

    worker.emitMessage({
      type: 'rifty:node-listening',
      ports: [5999],
      previewScope: 'late-scope',
    });
    expect(h.frames.at(-2)).toEqual({ type: 'pty:preview', ports: [] });
    h.runtime.handlePtyFrame({ type: 'pty:open', sid: 'terminal-too-late' });
    expect(h.frames.at(-1)).toEqual({
      type: 'pty:ready',
      sid: 'terminal-too-late',
      error: 'ClosedHandleError: pty server is closing',
    });
    await expect(settledOr(closing, 'pending')).resolves.toBe('pending');
    worker.emitExit(null, 'SIGTERM');
    await expect(closing).resolves.toBeUndefined();
    await running;
  });

  it('runs npm lifecycle bodies through a nested real Shell rooted in the project', async () => {
    const h = harness();
    h.runtime.handlePtyFrame({ type: 'pty:open', sid: 'terminal-npm' });

    await h.runtime.handlePtyFrame({
      type: 'pty:exec',
      sid: 'terminal-npm',
      rid: 'run-npm',
      line: 'npm run where',
      cols: 80,
      rows: 24,
      isTTY: true,
    });

    const output = h.frames
      .filter(
        (frame): frame is Extract<OwnerToPageFrame, { type: 'pty:chunk' }> =>
          frame.type === 'pty:chunk' && frame.rid === 'run-npm',
      )
      .map((frame) => new TextDecoder().decode(frame.data))
      .join('');
    expect(output).toContain(`${ROOT}\n`);
    expect(h.frames).toContainEqual(
      expect.objectContaining({
        type: 'pty:exit',
        rid: 'run-npm',
        code: 0,
        cwd: ROOT,
      }),
    );
    await h.runtime.close();
  });

  it('routes Shell writes through the package guard and reserved-path policy', async () => {
    const h = harness();
    h.runtime.handlePtyFrame({ type: 'pty:open', sid: 'terminal-write' });

    await h.runtime.handlePtyFrame({
      type: 'pty:exec',
      sid: 'terminal-write',
      rid: 'run-write',
      line: 'touch should-not-exist.txt node_modules/.rifty-install-stamp.json',
      cols: 80,
      rows: 24,
      isTTY: true,
    });

    const stderr = h.frames
      .filter(
        (frame): frame is Extract<OwnerToPageFrame, { type: 'pty:chunk' }> =>
          frame.type === 'pty:chunk' && frame.rid === 'run-write' && frame.stream === 'stderr',
      )
      .map((frame) => new TextDecoder().decode(frame.data))
      .join('');
    expect(stderr).toMatch(/EPERM.*reserved install-stamp authority claim/i);
    expect(h.frames).toContainEqual(
      expect.objectContaining({ type: 'pty:exit', rid: 'run-write', code: 1 }),
    );
    expect(h.authority.existsSync(`${ROOT}/node_modules/.rifty-install-stamp.json`)).toBe(false);
    expect(h.authority.existsSync(`${ROOT}/should-not-exist.txt`)).toBe(false);
    await h.runtime.close();
  });

  it('rejects legacy project reconfiguration instead of acknowledging a fake switch', async () => {
    const h = harness();

    await h.runtime.handlePtyFrame({
      type: 'pty:dev-config',
      id: 'legacy-config',
      templateId: 'other-project',
      slug: 'other-project',
      setup: 'from-scratch',
    });

    expect(h.frames).toContainEqual({
      type: 'pty:dev-config-ready',
      id: 'legacy-config',
      error: 'Workbench project config is immutable for the active project',
    });
    await h.runtime.close();
  });

  it('fails close loudly when the final owner durability barrier is unclean', async () => {
    const h = harness();
    h.authority.flush = async () => ({
      failures: [{ path: `${ROOT}/package.json`, op: 'write', message: 'quota exceeded' }],
      total: 1,
    });

    await expect(h.runtime.close()).rejects.toThrow(
      /Workbench project runtime close failed.*durability.*quota exceeded/is,
    );
    expect(h.frames.slice(-2)).toEqual([
      { type: 'pty:preview', ports: [] },
      { type: 'pty:dev-server', status: 'stopped' },
    ]);
  });

  it('waits for package mutations admitted before close to quiesce', async () => {
    const h = harness();
    const entered = deferred<void>();
    const release = deferred<void>();
    const mutation = h.packageState.mutations.guardedMutation(
      [{ kind: 'write', path: `${ROOT}/pending.txt` }],
      async () => {
        entered.resolve(undefined);
        await release.promise;
        h.authority.writeFileSync(`${ROOT}/pending.txt`, new Uint8Array());
      },
    );
    await entered.promise;

    const closing = h.runtime.close();
    await expect(settledOr(closing, 'pending')).resolves.toBe('pending');
    release.resolve(undefined);
    await mutation;
    await expect(closing).resolves.toBeUndefined();
  });

  it('shares one close promise with a re-entrant definitive-preview callback', async () => {
    let reentrant: Promise<void> | undefined;
    const h = harness((frame, runtime) => {
      if (frame.type === 'pty:preview' && frame.ports.length === 0 && reentrant === undefined) {
        reentrant = runtime().close();
      }
    });

    const closing = h.runtime.close();

    expect(reentrant).toBe(closing);
    await expect(closing).resolves.toBeUndefined();
  });

  it('rejects a package config whose root is not the owner-born project root', () => {
    const h = harness();

    expect(() =>
      createWorkbenchProjectRuntime({
        projectRoot: ROOT,
        packageConfig: {
          ...packageConfig,
          cfg: { ...packageConfig.cfg, root: '/page-claimed-root' },
        },
        authority: h.authority,
        packageState: h.packageState,
        nodeEntryWorkerUrl: 'https://example.test/node-entry.js',
        nodeWorkerRuntimeEnv: {},
        send: () => {},
      }),
    ).toThrow(/project root/i);
  });
});
