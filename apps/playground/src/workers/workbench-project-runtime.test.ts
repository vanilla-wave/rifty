import { globalProcessManager } from '@riftydev/kernel';
import { RegistryClient } from '@riftydev/npm-client';
import {
  NODE_ENTRY_BOOTSTRAP_PROTOCOL,
  type NodeEntryBootstrapPayload,
} from '@riftydev/runtime-js/builtins/node-entry-url';
import type { VfsMutationGuard } from '@riftydev/vfs';
import { createMemoryFs, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OwnerToPageFrame } from '../glue/pty-protocol.ts';
import { SyncMirrorVfs } from '../glue/sync-mirror-vfs.ts';
import type { BootstrapConfig } from '../templates/project-spec.ts';
import {
  type OwnerPackageConfig,
  type OwnerPackageMutationKind,
  createOwnerPackageState,
} from './owner-package-state.ts';
import { createOwnerVfsAuthorityComposition } from './owner-vfs-authority.ts';
import {
  type WorkbenchProjectRuntime,
  type WorkbenchProjectRuntimeOptions,
  createWorkbenchProjectRuntime,
} from './workbench-project-runtime.ts';

const ROOT = '/.rifty/workbench/v1/projects/project-a/tree';
const NODE_ENTRY_WORKER_URL = 'https://example.test/node-entry.js';
const DEV_SERVER_WORKER_URL = 'https://example.test/dev-server.js';
const NODE_WORKER_RUNTIME_ENV = Object.freeze({
  RIFTY_KERNEL_WORKER_URL: 'https://example.test/kernel.js',
  RIFTY_NODE_ENTRY_WORKER_URL: NODE_ENTRY_WORKER_URL,
  RIFTY_SQLITE_WASM_URL: 'https://example.test/sqlite.wasm',
  RIFTY_ESBUILD_WASM_URL: 'https://example.test/esbuild.wasm',
});
const NODE_WORKER_RUNTIME_CONFIG = Object.freeze({
  kernelWorkerUrl: NODE_WORKER_RUNTIME_ENV.RIFTY_KERNEL_WORKER_URL,
  nodeEntryWorkerUrl: NODE_WORKER_RUNTIME_ENV.RIFTY_NODE_ENTRY_WORKER_URL,
  sqliteWasmUrl: NODE_WORKER_RUNTIME_ENV.RIFTY_SQLITE_WASM_URL,
  esbuildWasmUrl: NODE_WORKER_RUNTIME_ENV.RIFTY_ESBUILD_WASM_URL,
});
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

const NODE_SERVER_PACKAGE_JSON = `${JSON.stringify({
  name: 'workbench-node-server',
  version: '1.0.0',
  type: 'module',
  scripts: { dev: 'node src/server.mjs' },
})}\n`;
const nodeServerPackageConfig: OwnerPackageConfig = {
  cfg: {
    runtime: 'node-server',
    root: ROOT,
    port: 4317,
    entryPath: `${ROOT}/src/server.mjs`,
    packageName: 'workbench-node-server',
    packageVersion: '1.0.0',
    installDeps: {},
    packageJson: NODE_SERVER_PACKAGE_JSON,
    seedFiles: {},
  },
  templateId: 'workbench-node-server',
  slug: 'project-a',
  fromScratch: true,
};

const NODE_CLI_PACKAGE_JSON = `${JSON.stringify({
  name: 'workbench-node-cli',
  version: '1.0.0',
  type: 'module',
})}\n`;
const nodeCliPackageConfig: OwnerPackageConfig = {
  cfg: {
    runtime: 'node-cli',
    root: ROOT,
    entryPath: `${ROOT}/src/cli.mjs`,
    packageName: 'workbench-node-cli',
    packageVersion: '1.0.0',
    installDeps: {},
    packageJson: NODE_CLI_PACKAGE_JSON,
    seedFiles: {},
  },
  templateId: 'workbench-node-cli',
  slug: 'project-a',
  fromScratch: true,
};

interface BoundaryWorker {
  readonly handle: ReturnType<typeof globalProcessManager.spawnWorker>;
  readonly command: () => Parameters<typeof globalProcessManager.spawnWorker>[0] | null;
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
  let capturedCommand: Parameters<typeof globalProcessManager.spawnWorker>[0] | null = null;
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
  vi.spyOn(globalProcessManager, 'spawnWorker').mockImplementation((command, spec) => {
    capturedCommand = command;
    capturedSpec = spec;
    return handle;
  });
  return {
    handle,
    command: () => capturedCommand,
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
  activePackageConfig: OwnerPackageConfig = packageConfig,
  publicationBarrier: () => Promise<void> = async () => {},
  recordMutation?: (kind: OwnerPackageMutationKind, treeRevision: number) => Promise<void>,
  runtimeAssetReader?: WorkbenchProjectRuntimeOptions['runtimeAssetReader'],
) {
  const pair = createMemoryFs();
  const { authority, installStampClaims } = createOwnerVfsAuthorityComposition(pair.fsSync, {
    ownerEpoch: 'workbench-project-runtime-test',
    initialRoots: ['/'],
  });
  setSyncMirror(authority, { async: pair.vfs });
  authority.mkdirSync(`${ROOT}/src`, { recursive: true });
  authority.mkdirSync(`${ROOT}/node_modules/.bin`, { recursive: true });
  authority.writeFileSync(
    `${ROOT}/package.json`,
    new TextEncoder().encode(activePackageConfig.cfg.packageJson),
  );
  authority.writeFileSync(
    activePackageConfig.cfg.entryPath,
    new TextEncoder().encode('export {};\n'),
  );
  authority.writeFileSync(
    `${ROOT}/node_modules/.bin/vite`,
    new TextEncoder().encode('#!/usr/bin/env node\n'),
  );
  const nodeWorkerRuntimeEnv =
    activePackageConfig.cfg.runtime === 'vite'
      ? { RIFTY_KERNEL_WORKER_URL: NODE_WORKER_RUNTIME_ENV.RIFTY_KERNEL_WORKER_URL }
      : NODE_WORKER_RUNTIME_ENV;
  const packageState = createOwnerPackageState({
    initial: activePackageConfig,
    vfs: new SyncMirrorVfs(),
    fsSync: authority,
    installStampClaims,
    flush: () => authority.flush(),
    nodeWorkerRuntimeEnv,
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
  const mutationGuard: VfsMutationGuard = (intents, apply) =>
    packageState.mutations.guardedMutation(intents, async () => {
      try {
        return await apply();
      } finally {
        await publicationBarrier();
      }
    });
  const runtimeOptions = {
    projectRoot: ROOT,
    packageConfig: activePackageConfig,
    authority,
    packageState,
    nodeEntryWorkerUrl: NODE_ENTRY_WORKER_URL,
    devServerWorkerUrl: DEV_SERVER_WORKER_URL,
    nodeWorkerRuntimeEnv,
    mutationGuard,
    publicationBarrier,
    ...(runtimeAssetReader === undefined ? {} : { runtimeAssetReader }),
    ...(recordMutation === undefined ? {} : { recordMutation }),
    send: (frame: OwnerToPageFrame) => {
      frames.push(frame);
      onSend?.(frame, () => {
        const current = runtimeRef.current;
        if (current === undefined) throw new Error('runtime callback fired during construction');
        return current;
      });
    },
  };
  const runtime = createWorkbenchProjectRuntime(runtimeOptions);
  runtimeRef.current = runtime;
  return { authority, frames, packageState, runtime };
}

afterEach(() => {
  vi.restoreAllMocks();
  resetSyncMirror();
});

describe('Workbench child runtime-asset public error Contract+RED', () => {
  it.each([
    {
      sibling: 'installed bin',
      config: packageConfig,
      line: 'vite --version',
      expectedStderr: 'vite: Runtime asset readiness failed\n',
    },
    {
      sibling: 'node entry',
      config: nodeCliPackageConfig,
      line: 'node src/cli.mjs',
      expectedStderr: 'node: Runtime asset readiness failed\n',
    },
    {
      sibling: 'dev server',
      config: nodeServerPackageConfig,
      line: 'npm run dev',
      expectedStderr: 'Runtime asset readiness failed\n',
    },
  ])(
    'projects unattested OwnerPackageState errors at the $sibling PTY boundary',
    async ({ config, line, expectedStderr }) => {
      const spawn = vi.spyOn(globalProcessManager, 'spawnWorker').mockImplementation(() => {
        throw new Error('unattested child crossed the physical spawn boundary');
      });
      const h = harness(
        undefined,
        config,
        async () => {},
        undefined,
        () => {
          throw new Error('unattested child constructed a runtime-asset reader');
        },
      );
      const sid = 'terminal-unattested';
      const rid = 'run-unattested';
      h.runtime.handlePtyFrame({ type: 'pty:open', sid });

      await h.runtime.handlePtyFrame({
        type: 'pty:exec',
        sid,
        rid,
        line,
        cols: 80,
        rows: 24,
        isTTY: true,
      });

      const stderr = h.frames
        .filter(
          (frame): frame is Extract<OwnerToPageFrame, { type: 'pty:chunk' }> =>
            frame.type === 'pty:chunk' && frame.rid === rid && frame.stream === 'stderr',
        )
        .map((frame) => new TextDecoder().decode(frame.data))
        .join('');
      await h.runtime.close();

      expect(stderr).toBe(expectedStderr);
      expect(stderr).not.toContain(ROOT);
      expect(stderr).not.toContain(config.slug);
      expect(stderr).not.toContain('package tree is unattested');
      expect(spawn).not.toHaveBeenCalled();
    },
  );
});

describe('Workbench finite Node owner lifecycle Contract+RED', () => {
  it('runs node-server npm dev in its dedicated entry-scoped child with PTY provenance', async () => {
    const worker = boundaryWorker();
    const h = harness(undefined, nodeServerPackageConfig);
    h.runtime.handlePtyFrame({
      type: 'pty:open',
      sid: 'terminal-node-server',
      env: {
        USER_FLAG: 'preserved',
        RIFTY_PREVIEW_SCOPE: 'guest-forged-scope',
        NAPI_RS_FORCE_WASI: 'guest-forged-wasi',
        PORT: '9999',
      },
    });

    const running = Promise.resolve(
      h.runtime.handlePtyFrame({
        type: 'pty:exec',
        sid: 'terminal-node-server',
        rid: 'run-node-server',
        line: 'npm run dev',
        cols: 101,
        rows: 41,
        isTTY: true,
      }),
    );
    await vi.waitFor(() => expect(worker.spec()).not.toBeNull());

    expect(worker.command()).toBe('dev-server');
    expect(worker.spec()).toMatchObject({
      cwd: '/',
      argv: ['rifty', '/src/server.mjs'],
      env: {
        USER_FLAG: 'preserved',
        RIFTY_PREVIEW_SCOPE: 'guest-forged-scope',
        NAPI_RS_FORCE_WASI: '1',
        PORT: '4317',
      },
      serve: true,
      entry: {
        kind: 'url',
        url: DEV_SERVER_WORKER_URL,
        bootstrap: {
          protocol: 'rifty.dev-server/v1',
          payload: {
            nodeWorkerRuntime: NODE_WORKER_RUNTIME_CONFIG,
            cfg: {
              ...nodeServerPackageConfig.cfg,
              root: '/',
              entryPath: '/src/server.mjs',
            },
            remoteFsRoot: ROOT,
            previewScope: expect.any(String),
            terminal: {
              stdinIsTTY: false,
              stdoutIsTTY: true,
              stderrIsTTY: true,
              cols: 101,
              rows: 41,
            },
          },
        },
      },
    });
    const entry = worker.spec()?.entry;
    if (entry?.kind !== 'url' || entry.bootstrap === undefined) {
      throw new Error('expected entry-scoped dev-server child bootstrap');
    }
    const payload = entry.bootstrap.payload as { readonly previewScope?: unknown };
    if (typeof payload.previewScope !== 'string') {
      throw new Error('expected owner-minted dev-server preview scope');
    }
    expect(payload.previewScope).not.toBe('guest-forged-scope');

    worker.emitMessage({
      type: 'rifty:dev-ready',
      port: 4317,
      previewScope: payload.previewScope,
    });
    await vi.waitFor(() =>
      expect(h.frames.filter((frame) => frame.type === 'pty:preview').at(-1)).toEqual({
        type: 'pty:preview',
        ports: [
          {
            port: 4317,
            url: '/preview/4317/',
            label: 'npm run dev',
            source: 'dev-server',
            sid: 'dev-server',
            ptySid: 'terminal-node-server',
            ptyRid: 'run-node-server',
            previewScope: payload.previewScope,
          },
        ],
      }),
    );
    expect(h.frames.filter((frame) => frame.type === 'pty:dev-server').at(-1)).toEqual({
      type: 'pty:dev-server',
      status: 'running',
      sid: 'terminal-node-server',
      cwd: ROOT,
      port: 4317,
      url: '/preview/4317/',
      previewScope: payload.previewScope,
    });

    h.runtime.handlePtyFrame({
      type: 'pty:signal',
      sid: 'terminal-node-server',
      rid: 'run-node-server',
      signal: 'SIGINT',
    });
    await vi.waitFor(() => expect(worker.killedWith()).toBe('SIGTERM'));
    worker.emitExit(null, 'SIGTERM');
    await running;
    expect(h.frames).toContainEqual({
      type: 'pty:exit',
      sid: 'terminal-node-server',
      rid: 'run-node-server',
      code: 130,
      exit: { code: null, signal: 'SIGTERM' },
      cwd: ROOT,
      env: {
        USER_FLAG: 'preserved',
        RIFTY_PREVIEW_SCOPE: 'guest-forged-scope',
        NAPI_RS_FORCE_WASI: 'guest-forged-wasi',
        PORT: '9999',
      },
    });
    await h.runtime.close();
  });

  it('runs node-cli through a supervised node child with exact empty argv and physical exit', async () => {
    const worker = boundaryWorker();
    const h = harness(undefined, nodeCliPackageConfig);
    h.runtime.handlePtyFrame({
      type: 'pty:open',
      sid: 'terminal-node-cli',
      env: { USER_FLAG: 'preserved' },
    });

    const running = Promise.resolve(
      h.runtime.handlePtyFrame({
        type: 'pty:exec',
        sid: 'terminal-node-cli',
        rid: 'run-node-cli',
        line: "node src/cli.mjs '' 'two words'",
        cols: 93,
        rows: 35,
        isTTY: true,
      }),
    );
    await vi.waitFor(() => expect(worker.spec()).not.toBeNull());

    expect(worker.command()).toBe('node');
    expect(worker.spec()).toMatchObject({
      cwd: '/',
      argv: ['rifty', '/src/cli.mjs', '', 'two words'],
      env: { USER_FLAG: 'preserved' },
      serve: true,
      entry: {
        kind: 'url',
        url: NODE_ENTRY_WORKER_URL,
        bootstrap: {
          protocol: NODE_ENTRY_BOOTSTRAP_PROTOCOL,
          payload: {
            hostRuntime: NODE_WORKER_RUNTIME_ENV,
            launch: {
              kind: 'program',
              bin: false,
              remoteFs: true,
              remoteFsRoot: ROOT,
              nodeServe: true,
              previewScope: expect.any(String),
              terminal: {
                stdinIsTTY: false,
                stdoutIsTTY: true,
                stderrIsTTY: true,
                cols: 93,
                rows: 35,
              },
            },
          },
        },
      },
    });

    worker.emitExit(7);
    await running;
    expect(h.frames).toContainEqual({
      type: 'pty:exit',
      sid: 'terminal-node-cli',
      rid: 'run-node-cli',
      code: 7,
      exit: { code: 7, signal: null },
      cwd: ROOT,
      env: { USER_FLAG: 'preserved' },
    });
    await h.runtime.close();
  });

  it.each([
    "node -e '1'",
    "node --eval '1'",
    'node --eval=1',
    "node -p '1'",
    "node --print '1'",
    'node --print=1',
  ])('keeps unsupported eval context loud without a temp write or child: %s', async (line) => {
    const spawn = vi.spyOn(globalProcessManager, 'spawnWorker').mockImplementation(() => {
      throw new Error('unexpected Node eval child spawn');
    });
    const h = harness(undefined, nodeCliPackageConfig);
    h.runtime.handlePtyFrame({ type: 'pty:open', sid: 'terminal-node-eval' });

    await h.runtime.handlePtyFrame({
      type: 'pty:exec',
      sid: 'terminal-node-eval',
      rid: 'run-node-eval',
      line,
      cols: 80,
      rows: 24,
      isTTY: true,
    });

    const stderr = h.frames
      .filter(
        (frame): frame is Extract<OwnerToPageFrame, { type: 'pty:chunk' }> =>
          frame.type === 'pty:chunk' && frame.rid === 'run-node-eval' && frame.stream === 'stderr',
      )
      .map((frame) => new TextDecoder().decode(frame.data))
      .join('');
    expect(stderr).toContain('Not implemented: workbench.node.eval-context');
    expect(spawn).not.toHaveBeenCalled();
    expect(
      h.authority.readdirSync(ROOT).some((entry) => entry.name.startsWith('.rifty-eval-')),
    ).toBe(false);
    expect(h.frames).toContainEqual(
      expect.objectContaining({ type: 'pty:exit', rid: 'run-node-eval', code: 1 }),
    );
    await h.runtime.close();
  });
});

describe('Workbench project runtime', () => {
  it('uses project-rooted Shells and actor-minted preview provenance despite forged guest env', async () => {
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
      cwd: '/',
      argv: ['rifty', '/node_modules/.bin/vite', '--port', '5173'],
      env: expect.objectContaining({
        USER_FLAG: 'preserved',
        RIFTY_PREVIEW_SCOPE: 'scope-forged',
        RIFTY_VITE_CLI_MODE: 'build',
      }),
      entry: {
        kind: 'url',
        url: 'https://example.test/node-entry.js',
        bootstrap: {
          protocol: NODE_ENTRY_BOOTSTRAP_PROTOCOL,
          payload: expect.objectContaining({
            hostRuntime: {
              RIFTY_KERNEL_WORKER_URL: 'https://example.test/kernel.js',
            },
            launch: expect.objectContaining({
              kind: 'program',
              bin: true,
              remoteFs: true,
              remoteFsRoot: ROOT,
              nodeServe: true,
              terminal: {
                stdinIsTTY: false,
                stdoutIsTTY: true,
                stderrIsTTY: true,
                cols: 90,
                rows: 30,
              },
            }),
          }),
        },
      },
    });
    expect(worker.spec()?.env.RIFTY_INTERNAL_PTY_SID).toBe('terminal-forged');
    const entry = worker.spec()?.entry;
    if (entry?.kind !== 'url' || entry.bootstrap === undefined) {
      throw new Error('expected node-entry URL bootstrap');
    }
    const payload = entry.bootstrap.payload as NodeEntryBootstrapPayload;
    if (payload.launch.kind !== 'program') throw new Error('expected program launch');
    expect(payload.launch.previewScope).not.toBe('scope-forged');

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

  it('exposes one project-rooted terminal namespace without leaking the owner root', async () => {
    const h = harness();
    h.runtime.handlePtyFrame({ type: 'pty:open', sid: 'terminal-namespace' });

    await h.runtime.handlePtyFrame({
      type: 'pty:exec',
      sid: 'terminal-namespace',
      rid: 'run-namespace',
      line: 'pwd; cd /; pwd; realpath /src/main.js; cat /src/main.js',
      cols: 80,
      rows: 24,
      isTTY: true,
    });

    const chunks = h.frames.filter(
      (frame): frame is Extract<OwnerToPageFrame, { type: 'pty:chunk' }> =>
        frame.type === 'pty:chunk' && frame.rid === 'run-namespace',
    );
    const stdout = chunks
      .filter((frame) => frame.stream === 'stdout')
      .map((frame) => new TextDecoder().decode(frame.data))
      .join('');
    const stderr = chunks
      .filter((frame) => frame.stream === 'stderr')
      .map((frame) => new TextDecoder().decode(frame.data))
      .join('');

    expect(stdout).toBe('/\n/\n/src/main.js\nexport {};\n');
    expect(stderr).toBe('');
    expect(`${stdout}${stderr}`).not.toContain(ROOT);
    expect(h.frames).toContainEqual(
      expect.objectContaining({ type: 'pty:exit', rid: 'run-namespace', code: 0 }),
    );
    await h.runtime.close();
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
    expect(output).toBe('/\n');
    expect(output).not.toContain(ROOT);
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

  it('binds terminal npm commands to owner package-mutation reflection', async () => {
    const recordMutation = vi.fn(
      async (_kind: OwnerPackageMutationKind, _treeRevision: number) => {},
    );
    const h = harness(undefined, packageConfig, async () => {}, recordMutation);
    const createNpmCommand = vi.spyOn(h.packageState, 'createNpmCommand');

    h.runtime.handlePtyFrame({ type: 'pty:open', sid: 'terminal-npm-mutations' });

    expect(createNpmCommand).toHaveBeenCalledWith(expect.any(Function), {
      recordMutation,
      mapInvocationContext: expect.any(Function),
    });
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

  it('publishes a real Shell rename before its matching PTY exit', async () => {
    const timeline: string[] = [];
    const h = harness(
      (frame) => {
        if (frame.type === 'pty:exit' && frame.rid === 'run-mv') timeline.push('exit');
      },
      packageConfig,
      async () => {
        timeline.push('barrier');
      },
    );
    const source = `${ROOT}/before.txt`;
    const target = `${ROOT}/after.txt`;
    const bytes = new TextEncoder().encode('moved by shell');
    h.authority.writeFileSync(source, bytes);
    h.runtime.handlePtyFrame({ type: 'pty:open', sid: 'terminal-mv' });

    await h.runtime.handlePtyFrame({
      type: 'pty:exec',
      sid: 'terminal-mv',
      rid: 'run-mv',
      line: 'mv before.txt after.txt',
      cols: 80,
      rows: 24,
      isTTY: true,
    });

    expect(h.authority.existsSync(source)).toBe(false);
    expect(h.authority.readFileBytesSync(target)).toEqual(bytes);
    expect(timeline).toEqual(['barrier', 'barrier', 'exit']);
    await h.runtime.close();
  });

  it('joins the beforeExit barrier for a Shell command with no mutation', async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    const timeline: string[] = [];
    const h = harness(
      (frame) => {
        if (frame.type === 'pty:exit' && frame.rid === 'run-echo') timeline.push('exit');
      },
      packageConfig,
      async () => {
        timeline.push('barrier-entered');
        entered.resolve(undefined);
        await release.promise;
        timeline.push('barrier-settled');
      },
    );
    h.runtime.handlePtyFrame({ type: 'pty:open', sid: 'terminal-echo' });
    const run = Promise.resolve(
      h.runtime.handlePtyFrame({
        type: 'pty:exec',
        sid: 'terminal-echo',
        rid: 'run-echo',
        line: 'echo no mutation',
        cols: 80,
        rows: 24,
        isTTY: true,
      }),
    );
    await expect(
      settledOr(
        entered.promise.then(() => 'entered'),
        'not-entered',
      ),
    ).resolves.toBe('entered');

    try {
      expect(timeline).toEqual(['barrier-entered']);
      await expect(settledOr(run, 'pending')).resolves.toBe('pending');
    } finally {
      release.resolve(undefined);
    }
    await expect(run).resolves.toBeUndefined();
    expect(timeline).toEqual(['barrier-entered', 'barrier-settled', 'exit']);
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

  it('ignores asset-only owner damage when closing one project runtime', async () => {
    const h = harness();
    const assetPath = '/.rifty/workbench/v1/runtime-assets/v1/objects/private-asset';
    h.authority.flush = async () => ({
      failures: [{ path: assetPath, op: 'write', message: 'private asset quota detail' }],
      total: 1,
    });

    await expect(h.runtime.close()).resolves.toBeUndefined();
  });

  it('keeps sibling-ledger details private when project close damage is mixed', async () => {
    const h = harness();
    const assetPath = '/.rifty/workbench/v1/runtime-assets/v1/objects/private-asset';
    h.authority.flush = async () => ({
      failures: [
        { path: assetPath, op: 'write', message: 'private asset quota detail' },
        { path: `${ROOT}/package.json`, op: 'write', message: 'project quota detail' },
      ],
      total: 2,
    });

    const failure = await h.runtime.close().then(
      () => null,
      (error: unknown) => error,
    );
    const detail = String(failure);
    expect(detail).toContain('project quota detail');
    expect(detail).not.toContain(assetPath);
    expect(detail).not.toContain('private asset quota detail');
    expect(detail).not.toContain(ROOT);
    expect(detail).not.toContain('2 unhealed');
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
        devServerWorkerUrl: 'https://example.test/dev-server.js',
        nodeWorkerRuntimeEnv: {},
        mutationGuard: async (_intents, apply) => await apply(),
        publicationBarrier: async () => {},
        send: () => {},
      }),
    ).toThrow(/project root/i);
  });
});
