/// <reference lib="webworker" />

import { makeGit, vfsToGitFs } from '@riftydev/git';
import { getKernelDispatcher } from '@riftydev/kernel';
import { registerNetBuiltins } from '@riftydev/net/register-builtins';
import { registerSqliteBuiltin } from '@riftydev/net/sqlite/register-builtins';
import {
  VfsTarballCache,
  createShadowAssetManager,
  createStandardShadowAssetSource,
} from '@riftydev/npm-client';
import { setProcessCwd } from '@riftydev/runtime-js/builtins/process';
import { resolveOwnerGitCommitIdentity } from '../glue/git-owner-port.ts';
import { installOwnerSyncRuntimeHandlers } from '../glue/owner-sync-runtime-handlers.ts';
import { createProxiedRegistryClient } from '../glue/registry-fetch.ts';
import { installSqliteWasmSyncProvider } from '../glue/sqlite-wasm-provider.ts';
import { ensureStarterInitialCommit } from '../glue/starter.ts';
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
import { createOwnerPackageState } from './owner-package-state.ts';
import {
  type PlaygroundProjectAuthority,
  createPlaygroundProjectAuthority,
} from './playground-project-authority.ts';
import { createOwnerPlaygroundSessionTools } from './playground-session-tools-owner.ts';
import {
  type WorkbenchConstructionLease,
  createWorkbenchConstructionTransaction,
} from './workbench-construction-transaction.ts';
import { createWorkbenchOwnerChildVfsMutationGuard } from './workbench-owner-child-vfs.ts';
import {
  assertCleanDurability,
  createCompanionOwnerClose,
  withOwnerClose,
} from './workbench-owner-close.ts';
import {
  type WorkbenchOwnerProjectRuntime,
  type WorkbenchOwnerProjectRuntimeOutput,
  createWorkbenchOwnerController,
} from './workbench-owner-controller.ts';
import { createWorkbenchOwnerStorageComposition } from './workbench-owner-storage-composition.ts';
import {
  workbenchFirstMaterializationPackageConfig,
  workbenchPackageConfig,
} from './workbench-package-config.ts';
import { createWorkbenchProjectComposition } from './workbench-project-composition.ts';
import { createWorkbenchProjectRuntime } from './workbench-project-runtime.ts';
import { createWorkbenchProjectStore } from './workbench-project-store.ts';
import { createWorkbenchProjectVfs } from './workbench-project-vfs.ts';
import { createNpmPackageRuntimeAssetPort } from './workbench-runtime-assets.ts';
import {
  type KernelIpc,
  installBundleLocalBuffer,
  installRuntimeGlobals,
} from './worker-runtime-globals.ts';

registerNetBuiltins();
registerSqliteBuiltin();

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

function playgroundTypeScriptWorkerUrl(config: WorkbenchOwnerBootConfig): string {
  const url = config.deployment.workers.typescript;
  if (url === undefined) {
    throw new Error('Playground session tools require deployment.workers.typescript');
  }
  return url;
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

async function bootstrap(): Promise<void> {
  const ipc = installRuntimeGlobals();
  installBundleLocalBuffer();
  setProcessCwd('/');
  if (ipc.onMessage === undefined) {
    throw new Error('Workbench owner requires fork IPC receive support');
  }

  const inbox = createInbox();
  let dispatch: (message: unknown) => void = inbox.push;
  ipc.onMessage((message) => dispatch(message));
  const config = firstMessage(await inbox.take(), ipc);
  if (config === null) return;

  const construction = createWorkbenchConstructionTransaction();
  try {
    const storageComposition = await createWorkbenchOwnerStorageComposition(
      config.storage.persistence,
    );
    const {
      storage,
      owner: ownerComposition,
      runtimeAssets: runtimeAssetStorage,
    } = storageComposition;
    const { authority, appliedMutations, installStampClaims } = ownerComposition;
    const authorityOwnership = construction.own(async () =>
      assertCleanDurability(await authority.flush()),
    );
    const storageOwnership = construction.own(() => runtimeAssetStorage.close());
    const registry = createProxiedRegistryClient({
      proxyPrefix: config.packageAcquisition.registryUrl,
    });
    const source = createStandardShadowAssetSource({
      registry,
      tarballCache: new VfsTarballCache(new SyncMirrorVfs()),
    });
    const sourceOwnership = construction.own(() => source.close());
    const runtimeAssetManager = createShadowAssetManager({
      storage: runtimeAssetStorage,
      source,
    });
    const runtimeAssetManagerOwnership = construction.transfer(
      [sourceOwnership, storageOwnership],
      () => runtimeAssetManager.close(),
    );
    const packageRuntimeAssets = createNpmPackageRuntimeAssetPort(runtimeAssetManager);

    const nodeWorkerRuntimeEnv = installNodeWorkerRuntimeConfig({
      kernelWorkerUrl: config.deployment.workers.kernel,
      nodeEntryWorkerUrl: config.deployment.workers.node,
      sqliteWasmUrl: config.deployment.wasm.sqlite,
      esbuildWasmUrl: config.deployment.wasm.esbuild,
    });
    installSqliteWasmSyncProvider(config.deployment.wasm.sqlite);

    const eddy = config.packageAcquisition.eddy;
    const packageState = createOwnerPackageState({
      vfs: new SyncMirrorVfs(),
      fsSync: authority,
      installStampClaims,
      flush: () => authority.flush(),
      nodeWorkerRuntimeEnv,
      log: (line) => globalThis.process.stdout.write(line),
      registry,
      runtimeAssets: packageRuntimeAssets,
      resolverUrl: () => eddy?.resolverUrl,
      resolverBundleBaseUrl: () => eddy?.bundleBaseUrl,
      resolverPin: (templateId) => eddy?.presetPins[templateId],
    });
    const packageStateOwnership = construction.own(() => packageState.quiesce());
    let materializer: ProjectMaterializer | undefined;
    let playgroundAuthority: PlaygroundProjectAuthority | undefined;
    let initialPlaygroundCatalog: PlaygroundCatalogSnapshot | undefined;
    let closeAuthority: (() => Promise<void>) | undefined;
    let closeAuthorityOwnership: WorkbenchConstructionLease | undefined;
    if (config.playgroundUrlContext === undefined) {
      const projectStore = createWorkbenchProjectStore(authority);
      const coreMaterializer = createProjectMaterializer({
        owner: projectStore,
        acquisition: {
          ensure: (request, options) =>
            packageState.activateAndEnsure(
              workbenchPackageConfig(request.definition, request.projectRoot, {
                packageJsonBytes: authority.readFileBytesSync(
                  `${request.projectRoot}/package.json`,
                ),
              }),
              options === undefined
                ? undefined
                : {
                    ...(options.signal === undefined ? {} : { signal: options.signal }),
                    ...(options.onRuntimeAssetProgress === undefined
                      ? {}
                      : { onProgress: options.onRuntimeAssetProgress }),
                  },
            ),
        },
      });
      const coreMaterializerOwnership = construction.own(() => coreMaterializer.close());
      materializer = withOwnerClose(
        coreMaterializer,
        () => packageState.quiesce(),
        () => runtimeAssetManager.close(),
        authority,
      );
      closeAuthority = () => (materializer as ProjectMaterializer).close();
      closeAuthorityOwnership = construction.transfer(
        [
          coreMaterializerOwnership,
          packageStateOwnership,
          runtimeAssetManagerOwnership,
          authorityOwnership,
        ],
        closeAuthority,
      );
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
          ensure: (request, options) =>
            packageState.activateAndEnsure(
              workbenchFirstMaterializationPackageConfig(request.definition, request.projectRoot, {
                packageJsonBytes: authority.readFileBytesSync(
                  `${request.projectRoot}/package.json`,
                ),
              }),
              options === undefined
                ? undefined
                : {
                    ...(options.signal === undefined ? {} : { signal: options.signal }),
                    ...(options.onRuntimeAssetProgress === undefined
                      ? {}
                      : { onProgress: options.onRuntimeAssetProgress }),
                  },
            ),
        },
      });
      const playgroundAuthorityOwnership = construction.own(() =>
        (playgroundAuthority as PlaygroundProjectAuthority).close(),
      );
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
      const catalogSubscriptionOwnership = construction.own(unsubscribeCatalog);
      if (initialReplay || initialPlaygroundCatalog === undefined) {
        throw new Error('Playground authority did not replay its initial catalog');
      }
      closeAuthority = createCompanionOwnerClose(
        playgroundAuthority,
        unsubscribeCatalog,
        () => packageState.quiesce(),
        () => runtimeAssetManager.close(),
        authority,
      );
      closeAuthorityOwnership = construction.transfer(
        [
          catalogSubscriptionOwnership,
          playgroundAuthorityOwnership,
          packageStateOwnership,
          runtimeAssetManagerOwnership,
          authorityOwnership,
        ],
        closeAuthority,
      );
    }

    let activeProjectRoot: string | null = null;
    let activeProjectVfs: ReturnType<typeof createWorkbenchProjectVfs> | null = null;
    let rejectOwnerLifetime = (error: Error): void => {
      throw error;
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
            send: (message: PlaygroundOwnerToPageMessage) =>
              sendPlaygroundOwnerMessage(ipc, message),
          });

    const controller = createWorkbenchOwnerController({
      runtimeAssets: runtimeAssetManager.admin,
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
                runtimeAssetReader: (plan) => runtimeAssetManager.runtimeReader(plan),
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
          const vfs = new SyncMirrorVfs();
          try {
            await ensureStarterInitialCommit(vfs, projectRoot);
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
              ...(input.recordMutation === undefined
                ? {}
                : { recordMutation: input.recordMutation }),
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
    if (closeAuthorityOwnership === undefined) {
      throw new Error('Workbench owner close ownership was not constructed');
    }
    construction.transfer([closeAuthorityOwnership], () =>
      controller.handle({ type: 'workbench:shutdown' }),
    );

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
        shutdownQueued ||=
          inspectPageToWorkbenchOwnerMessage(message).type === 'workbench:shutdown';
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
    construction.commit();
  } catch (error) {
    return construction.rollback(error, 'Workbench owner boot and cleanup failed');
  }
}

await bootstrap();
