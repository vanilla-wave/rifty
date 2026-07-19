import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  RegistryClient,
  type ShadowAssetPlan,
  type ShadowAssetSource,
  type ShadowAssetSourceRequest,
  type ShadowAssetStorage,
  type ShadowAssetStorageEntry,
  createMemoryShadowAssetStorage,
  createShadowAssetManager,
  planBuiltinShadowAssets,
} from '@riftydev/npm-client';
import { SW_FRAME_VERSION, SW_PONG, SW_ROUTING_VERSION } from '@riftydev/service-worker';
import { builtinShadowAssetCatalog } from '@riftydev/shadow-registry';
import { createMemoryFs, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';
import { createPtyClient } from '../glue/pty-client.ts';
import type { OwnerToPageFrame } from '../glue/pty-protocol.ts';
import { SyncMirrorVfs } from '../glue/sync-mirror-vfs.ts';
import { createOwnerPackageState } from '../workers/owner-package-state.ts';
import { createOwnerVfsAuthorityComposition } from '../workers/owner-vfs-authority.ts';
import {
  type OpenedPlaygroundProject,
  createPlaygroundProjectAuthority,
} from '../workers/playground-project-authority.ts';
import {
  workbenchFirstMaterializationPackageConfig,
  workbenchPackageConfig,
} from '../workers/workbench-package-config.ts';
import { createWorkbenchProjectComposition } from '../workers/workbench-project-composition.ts';
import { createWorkbenchProjectRuntime } from '../workers/workbench-project-runtime.ts';
import { createWorkbenchProjectVfs } from '../workers/workbench-project-vfs.ts';
import { createNpmPackageRuntimeAssetPort } from '../workers/workbench-runtime-assets.ts';
import { ProjectBusyError } from './errors.ts';
import {
  definePlaygroundProject,
  inspectPlaygroundProjectDefinition,
} from './internal/playground-project-definition.ts';
import { projectTerminalStateFromOwner } from './internal/playground-terminal-state.ts';
import {
  createOpenPlaygroundWorkbench,
  createPlaygroundWorkbenchFacade,
} from './internal/playground-workbench.ts';
import { createProjectRuntimeAcquisitionController } from './internal/project-runtime-acquisition.ts';
import { createNodeCliProjectRuntime } from './node-project-runtime.ts';
import {
  type OpenWorkbenchDependencies,
  createOpenWorkbench,
  inspectWorkbenchInternals,
} from './open-workbench.ts';
import type {
  PlaygroundProjectOpenOptions,
  PlaygroundProjectPlan,
  PlaygroundWorkbench,
  PlaygroundWorkbenchOptions,
} from './playground.ts';
import { createUnusedProjectContent } from './project-content.test-fixture.ts';
import type { ProjectDefinition } from './project-definition.ts';
import { type ProjectSession, createProjectSession } from './project-session.ts';
import {
  type ProjectTerminalPort,
  type ProjectTerminalPortState,
  createProjectTerminal,
} from './project-terminal.ts';
import type {
  PlaygroundWorkbenchOwnerHandle,
  WorkbenchOwnerHandle,
  WorkbenchOwnerPort,
} from './workbench-owner-port.ts';

const URL_CONTEXT = Object.freeze({
  apiBaseUrl: 'https://playground.invalid/app/',
  clientUrl: 'https://playground.invalid/app/index.html',
});
const PROJECT = Object.freeze({ root: '', slug: 'scratch' });
const NODE_WORKER_RUNTIME_ENV = Object.freeze({
  RIFTY_KERNEL_WORKER_URL: 'https://playground.invalid/workers/kernel.js',
  RIFTY_NODE_ENTRY_WORKER_URL: 'https://playground.invalid/workers/node.js',
  RIFTY_SQLITE_WASM_URL: 'https://playground.invalid/sqlite.wasm',
});

const require = createRequire(
  new URL('../../../../tools/shadow-registry/package.json', import.meta.url),
);
const ESBUILD_WASM_PACKAGE_ROOT = dirname(require.resolve('esbuild-wasm/package.json'));
let publishedEsbuildWasmTarballPromise: Promise<Uint8Array> | undefined;

function runNpmPack(packageRoot: string, destination: string, cache: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'npm',
      ['pack', packageRoot, '--pack-destination', destination, '--json'],
      {
        env: {
          ...process.env,
          npm_config_cache: cache,
          npm_config_update_notifier: 'false',
        },
        maxBuffer: 1024 * 1024,
      },
      (error) => {
        if (error) reject(error);
        else resolve();
      },
    );
  });
}

function publishedEsbuildWasmTarball(): Promise<Uint8Array> {
  publishedEsbuildWasmTarballPromise ??= (async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'rifty-active-recovery-esbuild-pack-'));
    const destination = join(tempRoot, 'pack');
    const cache = join(tempRoot, 'cache');
    try {
      await Promise.all([mkdir(destination), mkdir(cache)]);
      await runNpmPack(ESBUILD_WASM_PACKAGE_ROOT, destination, cache);
      return new Uint8Array(await readFile(join(destination, 'esbuild-wasm-0.28.0.tgz')));
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  })();
  return publishedEsbuildWasmTarballPromise;
}

class QuotaOnceStorage implements ShadowAssetStorage {
  readonly storageClass = 'memory-session' as const;
  readonly #inner = createMemoryShadowAssetStorage();
  #rejectObjectWrite = true;
  clearCalls = 0;

  read(entry: ShadowAssetStorageEntry): Promise<Uint8Array | null> {
    return this.#inner.read(entry);
  }

  write(entry: ShadowAssetStorageEntry, bytes: Uint8Array): Promise<void> {
    if (entry.kind === 'object' && this.#rejectObjectWrite) {
      this.#rejectObjectWrite = false;
      return Promise.reject(
        Object.assign(new Error('runtime asset object quota exhausted'), {
          code: 'EDQUOT',
          usedBytes: bytes.byteLength,
          requiredBytes: bytes.byteLength,
        }),
      );
    }
    return this.#inner.write(entry, bytes);
  }

  remove(entry: ShadowAssetStorageEntry): Promise<void> {
    return this.#inner.remove(entry);
  }

  inspect() {
    return this.#inner.inspect();
  }

  async clear(): Promise<void> {
    this.clearCalls += 1;
    await this.#inner.clear();
  }

  close(): Promise<void> {
    return this.#inner.close();
  }
}

function expectedPlan(): ShadowAssetPlan {
  return planBuiltinShadowAssets([
    {
      catalog: {
        id: builtinShadowAssetCatalog.id,
        digest: builtinShadowAssetCatalog.digest,
      },
      publicName: 'esbuild',
      requestedRange: '^0.28.0',
      resolvedPublicVersion: '0.28.0',
      substitutionId: 'rifty.shadow-substitution.esbuild-synthesized-delegate.v2',
      runtimeAdapterId: 'rifty.runtime-adapter.esbuild-vite.v1',
      builtin: true,
    },
  ]);
}

function registry(): RegistryClient {
  const tarballUrl = 'https://registry.invalid/esbuild/-/esbuild-0.28.0.tgz';
  return new RegistryClient({
    baseUrl: 'https://registry.invalid',
    maxRetries: 0,
    fetch: async (url) => {
      if (url === 'https://registry.invalid/esbuild') {
        return new Response(
          JSON.stringify({
            name: 'esbuild',
            'dist-tags': { latest: '0.28.0' },
            versions: {
              '0.28.0': {
                name: 'esbuild',
                version: '0.28.0',
                dist: { tarball: tarballUrl },
              },
            },
          }),
        );
      }
      if (url === tarballUrl) throw new Error('synthetic esbuild must not request a tarball');
      return new Response(null, { status: 404 });
    },
  });
}

function options(): PlaygroundWorkbenchOptions {
  return {
    deployment: {
      workers: {
        owner: '/owner.js',
        kernel: '/kernel.js',
        node: '/node.js',
        devServer: '/dev-server.js',
        typescript: '/typescript.js',
      },
      serviceWorker: { url: '/service-worker.js', scope: '/' },
      wasm: { sqlite: '/sqlite.wasm' },
    },
    packageAcquisition: { registryUrl: '/registry' },
    storage: { persistence: 'ephemeral' },
  };
}

function plan(): PlaygroundProjectPlan {
  return {
    kind: 'node-cli',
    id: 'scratch',
    starterId: 'runtime-asset-recovery',
    templateId: 'runtime-asset-recovery-v1',
    files: { '/index.mjs': 'console.log("not started by this lifecycle proof")\n' },
    dependencies: { esbuild: '^0.28.0' },
    entryPath: '/index.mjs',
    firstMaterialization: { kind: 'install' },
  };
}

function serviceWorkerDependencies(): Pick<
  OpenWorkbenchDependencies,
  'capabilities' | 'locks' | 'serviceWorker' | 'timers' | 'urlContext'
> {
  const controller = {
    postMessage(_message: unknown, transfer: Transferable[]) {
      const port = transfer[0];
      if (!(port instanceof MessagePort)) throw new Error('Missing service-worker reply port');
      port.postMessage({
        type: SW_PONG,
        from: 'service-worker',
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
      });
    },
  };
  return {
    urlContext: () => URL_CONTEXT,
    capabilities: () => ({ dom: true, worker: true, crossOriginIsolated: true, webLocks: true }),
    locks: {
      request: async (name, lockOptions, callback) => {
        await callback({ name, mode: lockOptions.mode });
      },
    },
    serviceWorker: {
      register: async () => {},
      controller,
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    timers: { setTimeout: () => 1, clearTimeout: () => {} },
  };
}

interface Harness {
  readonly workbench: PlaygroundWorkbench;
  readonly storage: QuotaOnceStorage;
  readonly packageState: ReturnType<typeof createOwnerPackageState>;
  currentProject(): Readonly<{ root: string; slug: string }>;
  ownerClearCalls(): number;
}

async function harness(): Promise<Harness> {
  const pair = createMemoryFs();
  const ownerComposition = createOwnerVfsAuthorityComposition(pair.fsSync, {
    ownerEpoch: 'active-companion-runtime-asset-recovery',
    initialRoots: ['/'],
  });
  const { authority, appliedMutations, installStampClaims } = ownerComposition;
  setSyncMirror(authority, { async: pair.vfs });

  const storage = new QuotaOnceStorage();
  const assetTarball = await publishedEsbuildWasmTarball();
  const source: ShadowAssetSource = Object.freeze({
    acquire: async (requests: readonly ShadowAssetSourceRequest[]) =>
      requests.map((request) =>
        Object.freeze({
          request,
          bytes: assetTarball.slice(),
          fillTransport: 'standard' as const,
          fillCache: 'network' as const,
        }),
      ),
    close: async () => {},
  });
  const manager = createShadowAssetManager({ storage, source });
  const packageState = createOwnerPackageState({
    vfs: new SyncMirrorVfs(),
    fsSync: authority,
    installStampClaims,
    flush: () => authority.flush(),
    nodeWorkerRuntimeEnv: NODE_WORKER_RUNTIME_ENV,
    log: () => {},
    registry: registry(),
    runtimeAssets: createNpmPackageRuntimeAssetPort(manager),
    resolverUrl: () => undefined,
    resolverBundleBaseUrl: () => undefined,
    resolverPin: () => undefined,
  });
  let stageSequence = 0;
  const playgroundAuthority = await createPlaygroundProjectAuthority({
    authority,
    installStampClaims,
    persistence: 'ephemeral',
    now: () => '2026-07-19T00:00:00.000Z',
    createStageId: () => `active-recovery-stage-${String(++stageSequence)}`,
    acquisition: {
      ensure: (request, acquisitionOptions) =>
        packageState.activateAndEnsure(
          workbenchFirstMaterializationPackageConfig(request.definition, request.projectRoot, {
            packageJsonBytes: authority.readFileBytesSync(`${request.projectRoot}/package.json`),
          }),
          acquisitionOptions === undefined
            ? undefined
            : {
                ...(acquisitionOptions.signal === undefined
                  ? {}
                  : { signal: acquisitionOptions.signal }),
                ...(acquisitionOptions.onRuntimeAssetProgress === undefined
                  ? {}
                  : { onProgress: acquisitionOptions.onRuntimeAssetProgress }),
              },
        ),
    },
  });

  let projectRoot = '';
  let terminalSequence = 0;
  const createOwnerSession = async <TReady>(
    definition: ProjectDefinition<TReady>,
    opened: OpenedPlaygroundProject,
  ): Promise<ProjectSession<TReady>> => {
    const inspected = inspectPlaygroundProjectDefinition(definition);
    if (inspected.kind !== 'node-cli') throw new Error('Recovery proof expected a Node CLI');
    projectRoot = opened.projectRoot;
    const packageConfig = workbenchPackageConfig(inspected, opened.projectRoot, {
      packageJsonBytes: authority.readFileBytesSync(`${opened.projectRoot}/package.json`),
    });
    let pty = createPtyClient({ send: () => {} });
    const composition = await createWorkbenchProjectComposition({
      createVfs: () =>
        createWorkbenchProjectVfs({
          projectRoot: opened.projectRoot,
          authority,
          appliedMutations,
          packageMutations: packageState.mutations,
          durability: 'ephemeral',
          emit: () => {},
          recordMutation: (kind, treeRevision) =>
            playgroundAuthority.recordMutation({
              kind,
              project: opened,
              treeRevision,
            }),
          fatal: (error) => {
            throw error;
          },
        }),
      createRuntime: (vfs) =>
        createWorkbenchProjectRuntime({
          projectRoot: opened.projectRoot,
          packageConfig,
          authority,
          packageState,
          nodeEntryWorkerUrl: NODE_WORKER_RUNTIME_ENV.RIFTY_NODE_ENTRY_WORKER_URL,
          devServerWorkerUrl: 'https://playground.invalid/workers/dev-server.js',
          nodeWorkerRuntimeEnv: NODE_WORKER_RUNTIME_ENV,
          runtimeAssetReader: (assetPlan) => manager.runtimeReader(assetPlan),
          mutationGuard: vfs.mutationGuard,
          publicationBarrier: vfs.publicationBarrier,
          recordMutation: (kind, treeRevision) =>
            playgroundAuthority.recordMutation({
              kind,
              project: opened,
              treeRevision,
            }),
          send(frame: OwnerToPageFrame) {
            pty.onFrame(frame);
          },
        }),
    });
    composition.vfs.publishSnapshot();
    const runtimeAcquisition = createProjectRuntimeAcquisitionController(opened.acquisition);
    pty = createPtyClient({
      send(frame) {
        void Promise.resolve(composition.runtime.handlePtyFrame(frame));
      },
      onFirstMaterializationConsumed: (evidence) =>
        runtimeAcquisition.acceptFirstMaterializationConsumed(evidence),
    });
    let alive = true;
    let resolveClosed!: (reason: unknown) => void;
    const closed = new Promise<unknown>((resolve) => {
      resolveClosed = resolve;
    });
    const port = Object.freeze({
      closed,
      isAlive: () => alive,
      openSession: (sid: string, initialState?: ProjectTerminalPortState) =>
        pty.openSession(sid, initialState ?? { cwd: opened.projectRoot }),
      snapshot: (sid: string) =>
        projectTerminalStateFromOwner(opened.projectRoot, pty.snapshot(sid)),
      execResult: pty.execResult,
      writeStdin: pty.writeStdin,
      endStdin: pty.endStdin,
      resizeSession: pty.resizeSession,
      resize: pty.resize,
      signal: pty.signal,
      closeSession: pty.closeSession,
    }) satisfies ProjectTerminalPort;
    const createTerminal = () =>
      createProjectTerminal({ id: `active-recovery-${String(++terminalSequence)}`, port });
    const terminal = createTerminal();
    const runtime = createNodeCliProjectRuntime({
      terminal,
      entryPath: inspected.entryPath,
      args: inspected.args,
      acquisition: runtimeAcquisition.runtime,
    });
    const content = createUnusedProjectContent('active-companion-runtime-asset-recovery');
    return createProjectSession({
      content,
      runtime,
      terminal,
      createTerminal,
      async closeOwner() {
        const outcomes = await Promise.allSettled([
          composition.runtime.close(),
          composition.vfs.close(),
          opened.close(),
        ]);
        alive = false;
        resolveClosed(undefined);
        pty.disconnect();
        const failures = outcomes.flatMap((outcome) =>
          outcome.status === 'rejected' ? [outcome.reason] : [],
        );
        if (failures.length === 1) throw failures[0];
        if (failures.length > 1) {
          throw new AggregateError(failures, 'Recovery project close failed');
        }
      },
    }) as ProjectSession<TReady>;
  };

  const catalog = Object.freeze({
    snapshot: () => playgroundAuthority.catalogSnapshot(),
    subscribe: (listener: Parameters<typeof playgroundAuthority.subscribeCatalog>[0]) =>
      playgroundAuthority.subscribeCatalog(listener),
    createScratch: (input: Parameters<typeof playgroundAuthority.createScratch>[0]) =>
      playgroundAuthority.createScratch(input),
    saveScratch: (input: Parameters<typeof playgroundAuthority.saveScratch>[0]) =>
      playgroundAuthority.saveScratch(input),
    activate: (target: Parameters<typeof playgroundAuthority.activate>[0]) =>
      playgroundAuthority.activate(target),
    rename: (id: string, name: string) => playgroundAuthority.rename(id, name),
    reset: (input: Parameters<typeof playgroundAuthority.reset>[0]) =>
      playgroundAuthority.reset(input),
    delete: (id: string) => playgroundAuthority.delete(id),
  });
  const playgroundHandle: PlaygroundWorkbenchOwnerHandle = Object.freeze({
    catalog,
    async openProject<TReady>(
      definition: ProjectDefinition<TReady>,
      projectOptions?: PlaygroundProjectOpenOptions,
    ) {
      const opened = await playgroundAuthority.openProject(
        definition,
        projectOptions?.initialTerminalState,
        projectOptions === undefined
          ? undefined
          : { onRuntimeAssetProgress: projectOptions.onRuntimeAssetProgress },
      );
      return await createOwnerSession(definition, opened);
    },
    sessionTools(): never {
      throw new Error('Recovery proof does not open the independent TS/SCM/archive companion');
    },
  });
  let ownerClosePromise: Promise<void> | null = null;
  let ownerClearCalls = 0;
  const ownerHandle: WorkbenchOwnerHandle = Object.freeze({
    openProject: async () => {
      throw new Error('Recovery proof routes opens through the Playground companion');
    },
    deleteProject: (id: string) => playgroundAuthority.deleteProject(id),
    inspectRuntimeAssets: () => manager.admin.inspectUsage(),
    clearRuntimeAssets: () => {
      ownerClearCalls += 1;
      return manager.admin.clearCache();
    },
    playground: playgroundHandle,
    close() {
      ownerClosePromise ??= (async () => {
        await packageState.quiesce();
        await playgroundAuthority.close();
        await manager.close();
        await authority.flush();
      })();
      return ownerClosePromise;
    },
  });
  const owner: WorkbenchOwnerPort = Object.freeze({
    start: async () => ({
      storage: Object.freeze({
        policy: 'ephemeral' as const,
        backend: 'memory' as const,
        durability: 'ephemeral' as const,
      }),
      owner: ownerHandle,
    }),
  });
  const rootDependencies: OpenWorkbenchDependencies = {
    ...serviceWorkerDependencies(),
    owner,
    openOwnerProject: ({ owner: admitted, definition, options: projectOptions }) => {
      const playground = admitted.playground;
      if (playground === undefined) throw new Error('Owner omitted the Playground companion');
      return playground.openProject(definition, projectOptions);
    },
  };
  const openRoot = createOpenWorkbench(rootDependencies);
  const open = createOpenPlaygroundWorkbench({
    captureUrlContext: () => URL_CONTEXT,
    openWorkbench: (workbenchOptions) => openRoot(workbenchOptions),
    createFacade({ workbench, urlContext }) {
      const internals = inspectWorkbenchInternals(workbench);
      const playground = internals.owner.playground;
      if (playground === undefined) throw new Error('Owner omitted the Playground companion');
      return createPlaygroundWorkbenchFacade({
        workbench,
        urlContext,
        definePlan: (projectPlan) => definePlaygroundProject(projectPlan, urlContext),
        catalog: playground.catalog,
        openProject: (definition, projectOptions) =>
          internals.openProjectWithOwner(definition, () =>
            playground.openProject(definition, projectOptions),
          ),
        createSessionTools: (session) => playground.sessionTools(session),
        registerBeforeClose: (session, hook) => internals.registerBeforeClose(session, hook),
      });
    },
  });
  const workbench = await open(options());
  return {
    workbench,
    storage,
    packageState,
    currentProject: () => Object.freeze({ ...PROJECT, root: projectRoot }),
    ownerClearCalls: () => ownerClearCalls,
  };
}

async function npmInstall(session: ProjectSession<unknown>): Promise<
  Readonly<{
    exitCode: number;
    output: string;
  }>
> {
  const terminal = session.terminals.open();
  const output: string[] = [];
  terminal.attach((chunk, stream) => output.push(`${stream}:${chunk}`));
  const run = terminal.run('npm install');
  const exit = await run.exited;
  await run.close();
  await terminal.close();
  return Object.freeze({ exitCode: exit.code ?? 1, output: output.join('') });
}

afterEach(() => resetSyncMirror());

/** Fault class: observable-order. Active clear cannot mutate owner/cache before close. */
describe('active companion runtime-asset recovery lifecycle', () => {
  it('keeps a post-tree failure inspectable until close, then clears, reopens, and retries', async () => {
    const h = await harness();
    let session: ProjectSession<unknown> | null = null;
    try {
      const definition = h.workbench.playground.define(plan());
      await h.workbench.playground.catalog.createScratch({ definition });
      session = await h.workbench.openProject(definition);

      const failed = await npmInstall(session);
      const pending = h.packageState.readPackageTreeEpoch(h.currentProject()).readiness;
      expect.soft(failed.exitCode).toBe(1);
      expect
        .soft(failed.output)
        .toContain(
          'stderr:npm: install failed: Runtime asset persistence failed (clear-and-retry)',
        );
      expect.soft(pending).toEqual({ kind: 'pending', plan: expectedPlan() });

      expect.soft(session.files.snapshot().entries).toEqual([]);
      const activeInspection = await h.workbench.runtimeAssets.inspect();
      const storageBeforeRejectedClear = await h.storage.inspect();
      const clearCallsBefore = h.storage.clearCalls;
      const ownerClearCallsBefore = h.ownerClearCalls();
      expect.soft(activeInspection.entryCount).toBeGreaterThan(0);

      await expect(h.workbench.runtimeAssets.clear()).rejects.toBeInstanceOf(ProjectBusyError);
      expect.soft(h.ownerClearCalls()).toBe(ownerClearCallsBefore);
      expect.soft(h.storage.clearCalls).toBe(clearCallsBefore);
      expect.soft(await h.storage.inspect()).toEqual(storageBeforeRejectedClear);
      expect
        .soft(h.packageState.readPackageTreeEpoch(h.currentProject()).readiness)
        .toEqual(pending);

      await session.close();
      session = null;
      await expect(h.workbench.runtimeAssets.clear()).resolves.toMatchObject({
        entryCount: 0,
        storedBytes: 0,
        verifiedObjectCount: 0,
        readySetCount: 0,
      });
      expect.soft(h.ownerClearCalls()).toBe(ownerClearCallsBefore + 1);

      session = await h.workbench.openProject(definition);
      const retried = await npmInstall(session);
      const ready = h.packageState.readPackageTreeEpoch(h.currentProject()).readiness;
      expect.soft(retried.exitCode).toBe(0);
      expect.soft(retried.output).toContain('stdout:npm: runtime assets ready: 1 (memory-session)');
      expect.soft(ready).toMatchObject({ kind: 'ready', plan: expectedPlan() });
      await expect(h.workbench.runtimeAssets.inspect()).resolves.toMatchObject({
        verifiedObjectCount: 1,
        readySetCount: 1,
      });
    } finally {
      await session?.close().catch(() => {});
      await h.workbench.close().catch(() => {});
    }
  });
});
