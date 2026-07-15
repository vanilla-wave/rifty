/// <reference lib="webworker" />

import { getKernelDispatcher } from '@riftydev/kernel';
import { registerNetBuiltins } from '@riftydev/net/register-builtins';
import { registerSqliteBuiltin } from '@riftydev/net/sqlite/register-builtins';
import { setProcessCwd } from '@riftydev/runtime-js/builtins/process';
import { syncMirror } from '@riftydev/vfs';
import { setSyncMirror } from '@riftydev/vfs/internal';
import { installOwnerSyncRuntimeHandlers } from '../glue/owner-sync-runtime-handlers.ts';
import { applyPackageAwareVfsMutations } from '../glue/package-mutation-executor.ts';
import { createProxiedRegistryClient } from '../glue/registry-fetch.ts';
import { installSqliteWasmSyncProvider } from '../glue/sqlite-wasm-provider.ts';
import { SyncMirrorVfs } from '../glue/sync-mirror-vfs.ts';
import { serializeWorkbenchOwnerError } from '../workbench/errors.ts';
import {
  type PageToWorkbenchOwnerMessage,
  type WorkbenchOwnerBootConfig,
  type WorkbenchOwnerToPageMessage,
  inspectPageToWorkbenchOwnerMessage,
  inspectWorkbenchOwnerToPageMessage,
} from '../workbench/owner-protocol.ts';
import {
  type ProjectMaterializer,
  createProjectMaterializer,
} from '../workbench/project-materialization.ts';
import { installNodeWorkerRuntimeConfig } from './node-worker-runtime-config.ts';
import { createOwnerPackageState } from './owner-package-state.ts';
import {
  type OwnerVfsAuthority,
  createOwnerVfsAuthorityComposition,
} from './owner-vfs-authority.ts';
import {
  type WorkbenchOwnerProjectRuntime,
  type WorkbenchOwnerProjectRuntimeOutput,
  createWorkbenchOwnerController,
} from './workbench-owner-controller.ts';
import { installWorkbenchOwnerStorage } from './workbench-owner-storage.ts';
import { workbenchPackageConfig } from './workbench-package-config.ts';
import { createWorkbenchProjectComposition } from './workbench-project-composition.ts';
import { createWorkbenchProjectRuntime } from './workbench-project-runtime.ts';
import { createWorkbenchProjectStore } from './workbench-project-store.ts';
import { createWorkbenchProjectVfs } from './workbench-project-vfs.ts';
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

function assertCleanDurability(report: Awaited<ReturnType<OwnerVfsAuthority['flush']>>): void {
  if (report === undefined || report.total === 0) return;
  const detail = report.failures
    .map((failure) => `${failure.op} ${failure.path}: ${failure.message}`)
    .join('; ');
  throw new Error(
    `${String(report.total)} unhealed persistence failure(s)${detail ? `: ${detail}` : ''}`,
  );
}

function withOwnerClose(
  materializer: ProjectMaterializer,
  packageQuiesce: () => Promise<void>,
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

  const storage = await installWorkbenchOwnerStorage(config.storage.persistence);
  const { authority, installStampClaims } = createOwnerVfsAuthorityComposition(syncMirror(), {
    initialRoots: ['/', '/.rifty'],
  });
  setSyncMirror(authority, { async: new SyncMirrorVfs() });

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
    registry: createProxiedRegistryClient({
      proxyPrefix: config.packageAcquisition.registryUrl,
    }),
    resolverUrl: () => eddy?.resolverUrl,
    resolverBundleBaseUrl: () => eddy?.bundleBaseUrl,
    resolverPin: (templateId) => eddy?.presetPins[templateId],
  });
  const projectStore = createWorkbenchProjectStore(authority);
  const coreMaterializer = createProjectMaterializer({
    owner: projectStore,
    acquisition: {
      ensure: (request) =>
        packageState.activateAndEnsure(
          workbenchPackageConfig(request.definition, request.projectRoot),
        ),
    },
  });
  const materializer = withOwnerClose(coreMaterializer, () => packageState.quiesce(), authority);

  let activeProjectRoot: string | null = null;
  let activeProjectVfs: ReturnType<typeof createWorkbenchProjectVfs> | null = null;
  installOwnerSyncRuntimeHandlers(
    getKernelDispatcher(),
    () => authority,
    (intents, apply) => {
      const root = activeProjectRoot;
      const projectVfs = activeProjectVfs;
      if (root === null || projectVfs === null) {
        throw new Error('ClosedHandleError: no active Workbench project owns child VFS writes');
      }
      return Promise.resolve(
        applyPackageAwareVfsMutations(packageState.mutations, root, intents, apply),
      ).then((result) => {
        if (activeProjectRoot !== root || activeProjectVfs !== projectVfs) {
          throw new Error('ClosedHandleError: Workbench project changed during child VFS write');
        }
        projectVfs.publishSnapshot();
        return result;
      });
    },
  );

  const controller = createWorkbenchOwnerController({
    materializer,
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
              packageMutations: packageState.mutations,
              durability: storage.durability,
              emit: (frame) => input.emit({ type: 'vfs', frame }),
            }),
          createRuntime: () =>
            createWorkbenchProjectRuntime({
              projectRoot,
              packageConfig: workbenchPackageConfig(input.definition, projectRoot),
              authority,
              packageState,
              nodeEntryWorkerUrl: config.deployment.workers.node,
              devServerWorkerUrl: config.deployment.workers.devServer,
              nodeWorkerRuntimeEnv,
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
      activeProjectVfs = projectVfs;
      return Object.freeze({
        handleFrame(message: Parameters<WorkbenchOwnerProjectRuntime['handleFrame']>[0]) {
          return message.type === 'vfs'
            ? projectVfs.handleFrame(message.frame)
            : runtime.handlePtyFrame(message.frame);
        },
        async close() {
          const failures: unknown[] = [];
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

await bootstrap();
