/// <reference lib="webworker" />

import { makeGit, vfsToGitFs } from '@riftydev/git';
import { getKernelDispatcher } from '@riftydev/kernel';
import { syncMirror } from '@riftydev/vfs';
import { setSyncMirror } from '@riftydev/vfs/internal';
import {
  amendStarterGeneratedBaseline,
  ensureStarterInitialCommit,
} from '../glue/git-initial-baseline.ts';
import { installOwnerSyncRuntimeHandlers } from '../glue/owner-sync-runtime-handlers.ts';
import { createProxiedRegistryClient } from '../glue/registry-fetch.ts';
import { installSqliteWasmSyncProvider } from '../glue/sqlite-wasm-provider.ts';
import { SyncMirrorVfs } from '../glue/sync-mirror-vfs.ts';
import { serializeWorkbenchOwnerError } from '../workbench/errors.ts';
import {
  type PlaygroundOwnerToPageMessage,
  inspectPlaygroundOwnerToPageMessage,
} from '../workbench/internal/playground-owner-protocol.ts';
import {
  type PageToWorkbenchOwnerMessage,
  type WorkbenchOwnerBootConfig,
  type WorkbenchOwnerToPageMessage,
  inspectPageToWorkbenchOwnerMessage,
  inspectWorkbenchOwnerToPageMessage,
} from '../workbench/owner-protocol.ts';
import type { PlaygroundCatalogSnapshot } from '../workbench/playground.ts';
import {
  type ProjectMaterializer,
  createProjectMaterializer,
} from '../workbench/project-materialization.ts';
import { installNodeWorkerRuntimeConfig } from './node-worker-runtime-config.ts';
import { createOwnerExecSyncRunner } from './owner-child-node-executor.ts';
import { resolveOwnerGitCommitIdentity } from './owner-git-commit-identity.ts';
import { createOwnerPackageState } from './owner-package-state.ts';
import { createOwnerShadowAssetAuthority } from './owner-shadow-assets.ts';
import {
  type OwnerVfsAuthority,
  type OwnerVfsAuthorityComposition,
  createOwnerVfsAuthorityComposition,
} from './owner-vfs-authority.ts';
import { recoverOwnerPlaygroundArchiveTransaction } from './playground-archive-integration.ts';
import {
  type PlaygroundProjectAuthority,
  createPlaygroundProjectAuthority,
} from './playground-project-authority.ts';
import { createOwnerPlaygroundSessionTools } from './playground-session-tools-owner.ts';
import { ProjectTerminalFsSync } from './project-terminal-namespace.ts';
import { createWorkbenchOwnerChildVfsMutationGuard } from './workbench-owner-child-vfs.ts';
import {
  type WorkbenchOwnerProjectRuntime,
  type WorkbenchOwnerProjectRuntimeOutput,
  createWorkbenchOwnerController,
} from './workbench-owner-controller.ts';
import { installWorkbenchOwnerStorageAuthority } from './workbench-owner-storage.ts';
import {
  workbenchFirstMaterializationPackageConfig,
  workbenchPackageConfig,
} from './workbench-package-config.ts';
import { createWorkbenchProjectComposition } from './workbench-project-composition.ts';
import { createWorkbenchProjectRuntime } from './workbench-project-runtime.ts';
import { createWorkbenchProjectStore } from './workbench-project-store.ts';
import { createWorkbenchProjectVfs } from './workbench-project-vfs.ts';
import type { KernelIpc } from './worker-runtime-globals.ts';

interface Inbox {
  readonly take: () => Promise<unknown>;
  readonly push: (message: unknown) => void;
  readonly drain: () => readonly unknown[];
}

function createInbox(): Inbox {
  const queued: unknown[] = [];
  const waiters: Array<(message: unknown) => void> = [];
  return {
    take: () => {
      const message = queued.shift();
      if (message !== undefined) return Promise.resolve(message);
      return new Promise((resolve) => waiters.push(resolve));
    },
    push(message) {
      const waiter = waiters.shift();
      if (waiter === undefined) queued.push(message);
      else waiter(message);
    },
    drain: () => queued.splice(0),
  };
}

function sendOwnerMessage(ipc: KernelIpc, message: WorkbenchOwnerToPageMessage): void {
  if (ipc.send === undefined) throw new Error('Workbench owner requires fork IPC send support');
  ipc.send(inspectWorkbenchOwnerToPageMessage(message));
}

function sendPlaygroundOwnerMessage(ipc: KernelIpc, message: PlaygroundOwnerToPageMessage): void {
  if (ipc.send === undefined) throw new Error('Workbench owner requires fork IPC send support');
  ipc.send(inspectPlaygroundOwnerToPageMessage(message));
}

function assertCleanDurability(report: Awaited<ReturnType<OwnerVfsAuthority['flush']>>): void {
  if (report === undefined || report.total === 0) return;
  const detail = report.failures
    .map((failure) => `${failure.op} ${failure.path}: ${failure.message}`)
    .join('; ');
  throw new Error(
    `${String(report.total)} unhealed persistence failure(s)${detail ? `: ${detail}` : ''}`,
  );
}

function playgroundTypeScriptWorkerUrl(config: WorkbenchOwnerBootConfig): string {
  const url = config.deployment.workers.typescript;
  if (url === undefined) {
    throw new Error('Playground session tools require deployment.workers.typescript');
  }
  return url;
}

function withOwnerClose(
  materializer: ProjectMaterializer,
  packageQuiesce: () => Promise<void>,
  closeShadowAssets: () => Promise<void>,
  authority: OwnerVfsAuthority,
): ProjectMaterializer {
  let closePromise: Promise<void> | null = null;
  return Object.freeze({
    open: (definition: Parameters<ProjectMaterializer['open']>[0]) => materializer.open(definition),
    delete: (id: string) => materializer.delete(id),
    close() {
      if (closePromise !== null) return closePromise;
      closePromise = (async () => {
        const failures: unknown[] = [];
        try {
          await materializer.close();
        } catch (error) {
          failures.push(error);
        }
        try {
          await packageQuiesce();
        } catch (error) {
          failures.push(error);
        }
        try {
          await closeShadowAssets();
        } catch (error) {
          failures.push(error);
        }
        try {
          assertCleanDurability(await authority.flush());
        } catch (error) {
          failures.push(error);
        }
        if (failures.length === 1) throw failures[0];
        if (failures.length > 1) {
          throw new AggregateError(failures, 'Workbench owner authority close failed');
        }
      })();
      return closePromise;
    },
  });
}

function createCompanionOwnerClose(
  authority: PlaygroundProjectAuthority,
  unsubscribeCatalog: () => void,
  packageQuiesce: () => Promise<void>,
  closeShadowAssets: () => Promise<void>,
  vfsAuthority: OwnerVfsAuthority,
): () => Promise<void> {
  let closePromise: Promise<void> | null = null;
  return () => {
    if (closePromise !== null) return closePromise;
    closePromise = (async () => {
      const failures: unknown[] = [];
      try {
        unsubscribeCatalog();
      } catch (error) {
        failures.push(error);
      }
      try {
        await authority.close();
      } catch (error) {
        failures.push(error);
      }
      try {
        await packageQuiesce();
      } catch (error) {
        failures.push(error);
      }
      try {
        await closeShadowAssets();
      } catch (error) {
        failures.push(error);
      }
      try {
        assertCleanDurability(await vfsAuthority.flush());
      } catch (error) {
        failures.push(error);
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) {
        throw new AggregateError(failures, 'Playground owner authority close failed');
      }
    })();
    return closePromise;
  };
}

function firstMessage(raw: unknown, ipc: KernelIpc): WorkbenchOwnerBootConfig | null {
  let message: PageToWorkbenchOwnerMessage;
  try {
    message = inspectPageToWorkbenchOwnerMessage(raw);
  } catch (error) {
    sendOwnerMessage(ipc, {
      type: 'workbench:failure',
      error: serializeWorkbenchOwnerError(error),
    });
    throw error;
  }
  if (message.type === 'workbench:shutdown') return null;
  if (message.type !== 'workbench:initialize') {
    const error = new TypeError('Workbench owner must be initialized before project operations');
    sendOwnerMessage(ipc, {
      type: 'workbench:failure',
      error: serializeWorkbenchOwnerError(error),
    });
    throw error;
  }
  return message.config;
}

export async function runWorkbenchOwner(ipc: KernelIpc): Promise<void> {
  if (ipc.onMessage === undefined) {
    throw new Error('Workbench owner requires fork IPC receive support');
  }

  const inbox = createInbox();
  let dispatch: (message: unknown) => void = inbox.push;
  ipc.onMessage((message) => dispatch(message));
  const config = firstMessage(await inbox.take(), ipc);
  if (config === null) return;

  const storageAuthority = await installWorkbenchOwnerStorageAuthority(config.storage.persistence);
  const storage = storageAuthority.snapshot;
  const ownerComposition: OwnerVfsAuthorityComposition = createOwnerVfsAuthorityComposition(
    syncMirror(),
    { initialRoots: ['/', '/.rifty'] },
  );
  const { authority, appliedMutations, installStampClaims } = ownerComposition;
  setSyncMirror(authority, { async: new SyncMirrorVfs() });

  const nodeWorkerRuntimeEnv = installNodeWorkerRuntimeConfig({
    kernelWorkerUrl: config.deployment.workers.kernel,
    nodeEntryWorkerUrl: config.deployment.workers.node,
    sqliteWasmUrl: config.deployment.wasm.sqlite,
  });
  installSqliteWasmSyncProvider(config.deployment.wasm.sqlite);

  const eddy = config.packageAcquisition.eddy;
  const ownerVfs = new SyncMirrorVfs();
  const starterInitialOids = new Map<string, string>();
  const amendGeneratedBaseline = async (root: string, lockfile: Uint8Array): Promise<boolean> => {
    const expectedInitialOid = starterInitialOids.get(root);
    starterInitialOids.delete(root);
    if (expectedInitialOid === undefined) return false;
    const amended = await amendStarterGeneratedBaseline(
      ownerVfs,
      root,
      expectedInitialOid,
      lockfile,
    );
    if (!amended) return false;
    assertCleanDurability(await authority.flush());
    return true;
  };
  const registry = createProxiedRegistryClient({
    proxyPrefix: config.packageAcquisition.registryUrl,
  });
  const shadowAssets = (
    await createOwnerShadowAssetAuthority({
      ownerStorage: storage,
      vfs: ownerVfs,
      registry,
      ...(storageAuthority.opfs === undefined
        ? {}
        : {
            durability: {
              persistedVfs: storageAuthority.opfs.persistedVfs,
              flush: async () => {
                const report = await authority.flush();
                if (report === undefined) {
                  throw new Error('OPFS shadow asset flush returned no durability report');
                }
                return report;
              },
            },
          }),
    })
  ).manager;
  const packageState = createOwnerPackageState({
    vfs: ownerVfs,
    fsSync: authority,
    installStampClaims,
    flush: () => authority.flush(),
    amendGeneratedBaseline,
    nodeWorkerRuntimeEnv,
    log: (line) => globalThis.process.stdout.write(line),
    registry,
    shadowAssets,
    resolverUrl: () => eddy?.resolverUrl,
    resolverBundleBaseUrl: () => eddy?.bundleBaseUrl,
    resolverPin: (templateId) => eddy?.presetPins[templateId],
  });
  let materializer: ProjectMaterializer | undefined;
  let playgroundAuthority: PlaygroundProjectAuthority | undefined;
  let initialPlaygroundCatalog: PlaygroundCatalogSnapshot | undefined;
  let closeAuthority: (() => Promise<void>) | undefined;
  if (config.playgroundUrlContext === undefined) {
    const projectStore = createWorkbenchProjectStore(authority);
    const coreMaterializer = createProjectMaterializer({
      owner: projectStore,
      acquisition: {
        ensure: (request) =>
          packageState.activateAndEnsure(
            workbenchPackageConfig(request.definition, request.projectRoot, {
              packageJsonBytes: authority.readFileBytesSync(`${request.projectRoot}/package.json`),
            }),
          ),
      },
    });
    materializer = withOwnerClose(
      coreMaterializer,
      () => packageState.quiesce(),
      () => shadowAssets.close(),
      authority,
    );
    closeAuthority = () => (materializer as ProjectMaterializer).close();
  } else {
    playgroundAuthority = await createPlaygroundProjectAuthority({
      authority,
      installStampClaims,
      persistence: config.storage.persistence,
      ...(config.legacyWorkspacePrefix === undefined
        ? {}
        : { legacyWorkspacePrefix: config.legacyWorkspacePrefix }),
      now: () => new Date().toISOString(),
      createStageId: () => globalThis.crypto.randomUUID(),
      acquisition: {
        ensure: (request) =>
          packageState.activateAndEnsure(
            workbenchFirstMaterializationPackageConfig(request.definition, request.projectRoot, {
              packageJsonBytes: authority.readFileBytesSync(`${request.projectRoot}/package.json`),
            }),
          ),
      },
      beforeOpenProject: (projectRoot) =>
        recoverOwnerPlaygroundArchiveTransaction({
          projectRoot,
          owner: ownerComposition,
          packages: packageState,
        }),
    });
    let initialReplay = true;
    const unsubscribeCatalog = playgroundAuthority.subscribeCatalog((catalog) => {
      if (initialReplay) {
        initialReplay = false;
        initialPlaygroundCatalog = catalog;
        return;
      }
      sendPlaygroundOwnerMessage(ipc, {
        type: 'workbench:playground-catalog-updated',
        catalog,
      });
    });
    if (initialReplay || initialPlaygroundCatalog === undefined) {
      throw new Error('Playground authority did not replay its initial catalog');
    }
    closeAuthority = createCompanionOwnerClose(
      playgroundAuthority,
      unsubscribeCatalog,
      () => packageState.quiesce(),
      () => shadowAssets.close(),
      authority,
    );
  }

  let activeProjectRoot: string | null = null;
  let activeProjectVfs: ReturnType<typeof createWorkbenchProjectVfs> | null = null;
  let rejectOwnerLifetime = (error: Error): void => {
    throw error;
  };
  const requireActiveProjectRoot = (): string => {
    if (activeProjectRoot === null) {
      throw new Error('Workbench owner execSync requires an active project');
    }
    return activeProjectRoot;
  };
  installOwnerSyncRuntimeHandlers(
    getKernelDispatcher(),
    () => authority,
    createWorkbenchOwnerChildVfsMutationGuard({
      activeProject: () =>
        activeProjectRoot === null || activeProjectVfs === null
          ? null
          : { root: activeProjectRoot, vfs: activeProjectVfs },
    }),
    {
      getVfs: () => new ProjectTerminalFsSync(authority, requireActiveProjectRoot()),
      runWorker: createOwnerExecSyncRunner(
        config.deployment.workers.node,
        nodeWorkerRuntimeEnv,
        requireActiveProjectRoot,
        (root) => packageState.reserveChildAdmission(root),
      ),
    },
  );

  if (closeAuthority === undefined) {
    throw new Error('Workbench owner close authority was not constructed');
  }
  const companionController =
    config.playgroundUrlContext === undefined || playgroundAuthority === undefined
      ? undefined
      : Object.freeze({
          urlContext: config.playgroundUrlContext,
          authority: playgroundAuthority,
          send: (message: PlaygroundOwnerToPageMessage) => sendPlaygroundOwnerMessage(ipc, message),
        });

  const controller = createWorkbenchOwnerController({
    ...(materializer === undefined ? {} : { materializer }),
    closeAuthority,
    ...(companionController === undefined ? {} : { playground: companionController }),
    send: (message) => sendOwnerMessage(ipc, message),
    async createProject(input) {
      const projectRoot = input.materialized.projectRoot;
      if (activeProjectRoot !== null) {
        throw new Error('Workbench owner already has an active project runtime');
      }
      activeProjectRoot = projectRoot;
      let runtime: ReturnType<typeof createWorkbenchProjectRuntime>;
      let projectVfs: ReturnType<typeof createWorkbenchProjectVfs>;
      try {
        const composition = await createWorkbenchProjectComposition({
          createVfs: () =>
            createWorkbenchProjectVfs({
              projectRoot,
              authority,
              appliedMutations,
              packageMutations: packageState.mutations,
              durability: storage.durability,
              emit: (frame) => input.emit({ type: 'vfs', frame }),
              ...(input.recordMutation === undefined
                ? {}
                : { recordMutation: input.recordMutation }),
              fatal: (error) => rejectOwnerLifetime(error),
            }),
          createRuntime: (vfs) =>
            createWorkbenchProjectRuntime({
              projectRoot,
              packageConfig: workbenchPackageConfig(input.definition, projectRoot, {
                packageJsonBytes: authority.readFileBytesSync(`${projectRoot}/package.json`),
              }),
              authority,
              packageState,
              nodeEntryWorkerUrl: config.deployment.workers.node,
              devServerWorkerUrl: config.deployment.workers.devServer,
              nodeWorkerRuntimeEnv,
              mutationGuard: vfs.mutationGuard,
              publicationBarrier: vfs.publicationBarrier,
              ...(input.recordMutation === undefined
                ? {}
                : { recordMutation: input.recordMutation }),
              send(frame) {
                const output: WorkbenchOwnerProjectRuntimeOutput =
                  frame.type === 'pty:preview'
                    ? { type: 'preview', frame }
                    : { type: 'pty', frame };
                input.emit(output);
              },
            }),
        });
        runtime = composition.runtime;
        projectVfs = composition.vfs;
      } catch (error) {
        activeProjectRoot = null;
        throw error;
      }
      let playgroundTools:
        | Awaited<ReturnType<typeof createOwnerPlaygroundSessionTools>>
        | undefined;
      if (playgroundAuthority !== undefined) {
        const vfs = ownerVfs;
        try {
          await packageState.mutations.guardedMutation([], async () => {
            starterInitialOids.delete(projectRoot);
            const initialOid = await ensureStarterInitialCommit(vfs, projectRoot);
            if (initialOid !== null) starterInitialOids.set(projectRoot, initialOid);
          });
          const git = makeGit({
            fs: vfsToGitFs(vfs),
            dir: projectRoot,
            assertPortablePaths: (paths) => authority.assertPortablePaths(paths),
          });
          playgroundTools = await createOwnerPlaygroundSessionTools({
            projectRoot,
            owner: ownerComposition,
            packages: packageState,
            projectVfs,
            vfs,
            git,
            commitIdentity: await resolveOwnerGitCommitIdentity(git),
            tsWorkerUrl: playgroundTypeScriptWorkerUrl(config),
            nodeWorkerRuntimeEnv,
            send: (frame) => {
              input.emit({ type: 'playground-tools', frame });
              return undefined;
            },
            fatal: (error) => rejectOwnerLifetime(error),
            ...(input.recordMutation === undefined ? {} : { recordMutation: input.recordMutation }),
            log: (line) => globalThis.process.stdout.write(line),
          });
        } catch (error) {
          const outcomes = await Promise.allSettled([runtime.close(), projectVfs.close()]);
          const failures = [error];
          for (const outcome of outcomes) {
            if (outcome.status === 'rejected' && !failures.includes(outcome.reason)) {
              failures.push(outcome.reason);
            }
          }
          activeProjectRoot = null;
          if (failures.length === 1) throw failures[0];
          throw new AggregateError(
            failures,
            'Playground project session-tools construction and cleanup failed',
          );
        }
      }
      activeProjectVfs = projectVfs;
      return Object.freeze({
        ...(playgroundTools === undefined
          ? {}
          : {
              playgroundTools: Object.freeze({
                initialScmSnapshot: playgroundTools.initialScmSnapshot,
                handle: (frame: Parameters<typeof playgroundTools.handle>[0]) =>
                  playgroundTools.handle(frame),
              }),
            }),
        handleFrame(message: Parameters<WorkbenchOwnerProjectRuntime['handleFrame']>[0]) {
          return message.type === 'vfs'
            ? projectVfs.handleFrame(message.frame)
            : runtime.handlePtyFrame(message.frame);
        },
        async close() {
          const failures: unknown[] = [];
          if (playgroundTools !== undefined) {
            try {
              await playgroundTools.close();
            } catch (error) {
              failures.push(error);
            }
          }
          try {
            await runtime.close();
          } catch (error) {
            failures.push(error);
          }
          try {
            await projectVfs.close();
          } catch (error) {
            failures.push(error);
          } finally {
            if (activeProjectVfs === projectVfs) activeProjectVfs = null;
            if (activeProjectRoot === projectRoot) activeProjectRoot = null;
          }
          if (failures.length === 1) throw failures[0];
          if (failures.length > 1) {
            throw new AggregateError(failures, 'Workbench project runtime and VFS close failed');
          }
        },
      });
    },
  });

  const fatal = new Promise<never>((_resolve, reject) => {
    rejectOwnerLifetime = reject;
    dispatch = (message) => {
      void controller.handle(message).catch(reject);
    };
  });
  const queued = inbox.drain();
  let shutdownQueued = false;
  for (const message of queued) {
    try {
      shutdownQueued ||= inspectPageToWorkbenchOwnerMessage(message).type === 'workbench:shutdown';
    } catch {
      // Controller owns the exact failure reply.
    }
    dispatch(message);
  }
  if (!shutdownQueued) {
    if (companionController !== undefined) {
      if (initialPlaygroundCatalog === undefined) {
        throw new Error('Playground initial catalog is unavailable at owner readiness');
      }
      sendPlaygroundOwnerMessage(ipc, {
        type: 'workbench:playground-ready',
        catalog: initialPlaygroundCatalog,
      });
    }
    sendOwnerMessage(ipc, { type: 'workbench:owner-ready', storage });
  }

  try {
    await Promise.race([controller.lifetime, fatal]);
  } catch (error) {
    const cleanup = await Promise.allSettled([controller.handle({ type: 'workbench:shutdown' })]);
    const failures = [error];
    for (const outcome of cleanup) {
      if (outcome.status === 'rejected' && !failures.includes(outcome.reason)) {
        failures.push(outcome.reason);
      }
    }
    if (failures.length === 1) throw failures[0];
    throw new AggregateError(failures, 'Workbench owner failed and cleanup also failed');
  }
}
