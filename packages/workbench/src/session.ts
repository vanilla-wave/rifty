import { COI_REQUIRED_MESSAGE, type CapabilityCheck, checkCapabilities } from '@riftydev/sdk';
import { type RegisterServiceWorkerOptions, registerServiceWorker } from '@riftydev/service-worker';
import { type WorkbenchSessionConfig, resolveWorkbenchConfig } from './config.ts';
import { type EditorController, createEditorController } from './controllers/editor.ts';
import { type FilesController, createFilesController } from './controllers/files.ts';
import { type PreviewController, createPreviewController } from './controllers/preview.ts';
import { type TerminalController, createTerminalController } from './controllers/terminal.ts';
import { invokeHostCallback, notifySubscribers } from './fault-boundary.ts';
import type { OwnerBridgeKey } from './glue/owner-bridge-key.ts';
import { startWorkspaceOwner, wirePreviewBridge } from './glue/realVite.ts';
import type { WorkspaceOwnerHandle, WorkspaceOwnerOptions } from './glue/realVite.ts';
import { proveRiftyServiceWorkerControl } from './glue/service-worker-control.ts';
import { type StoragePersistenceStatus, probeStoragePersistence } from './glue/storage-status.ts';
import { createTerminalManager } from './glue/terminal-manager.ts';
import {
  type VfsSnapshotFrame,
  requestVfsSnapshot,
  subscribeVfsSnapshot,
} from './glue/vfs-snapshot-port.ts';
import { resolveProjectSpec } from './project-catalog.ts';

export const WORKBENCH_SINGLETON_ERROR =
  '@riftydev/workbench supports one active workbench session per page';

export type WorkbenchSessionStatus = 'idle' | 'booting' | 'ready' | 'error' | 'disposed';

export interface WorkbenchStorageSnapshot {
  readonly backend: 'opfs' | 'memory' | null;
  readonly degraded: boolean;
  readonly persistence: StoragePersistenceStatus | null;
}

export interface WorkbenchSessionSnapshot {
  readonly status: WorkbenchSessionStatus;
  readonly capabilities: CapabilityCheck;
  readonly storage: WorkbenchStorageSnapshot;
  readonly serviceWorkerError: string | null;
  readonly error: string | null;
}

export interface WorkbenchControllers {
  readonly terminal: TerminalController;
  readonly preview: PreviewController;
  readonly editor: EditorController;
  readonly files: FilesController;
}

export interface WorkbenchSession {
  snapshot(): WorkbenchSessionSnapshot;
  subscribe(listener: (snapshot: WorkbenchSessionSnapshot) => void): () => void;
  /** Boot the configured owner once and return stable headless controllers. */
  boot(): Promise<WorkbenchControllers>;
  /** Read the booted controller set; throws before a successful boot. */
  controllers(): WorkbenchControllers;
  /** Tear down routes/controllers/PTYS, then wait for the owner worker to exit. */
  dispose(): Promise<void>;
}

export interface WorkbenchSessionDependencies {
  readonly checkCapabilities: () => CapabilityCheck;
  readonly registerServiceWorker: (
    url: string,
    options: RegisterServiceWorkerOptions,
  ) => Promise<unknown>;
  readonly proveServiceWorkerControl: (timeoutMs: number) => Promise<void>;
  readonly startWorkspaceOwner: (options: WorkspaceOwnerOptions) => WorkspaceOwnerHandle;
  readonly probeStoragePersistence: () => Promise<StoragePersistenceStatus>;
  readonly mountPreviewBridge: (
    port: number,
    ownerToken: string,
    previewScope?: string,
  ) => () => void;
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  readonly subscribeSnapshot: (
    key: OwnerBridgeKey,
    listener: (frame: VfsSnapshotFrame) => void,
  ) => () => void;
  readonly requestSnapshot: (key: OwnerBridgeKey) => void;
}

const REAL_DEPENDENCIES: WorkbenchSessionDependencies = {
  checkCapabilities,
  registerServiceWorker,
  proveServiceWorkerControl: (timeoutMs) => proveRiftyServiceWorkerControl({ timeoutMs }),
  startWorkspaceOwner,
  probeStoragePersistence,
  mountPreviewBridge: wirePreviewBridge,
  fetch: (url, init) => globalThis.fetch(url, init),
  subscribeSnapshot: subscribeVfsSnapshot,
  requestSnapshot: requestVfsSnapshot,
};

let activeSessionToken: symbol | null = null;

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function copyCapabilities(check: CapabilityCheck): CapabilityCheck {
  return {
    capabilities: { ...check.capabilities },
    missing: [...check.missing],
    sufficient: check.sufficient,
    summary: check.summary,
  };
}

export function createWorkbenchSession(config: WorkbenchSessionConfig): WorkbenchSession {
  return createWorkbenchSessionForTesting(config, REAL_DEPENDENCIES);
}

/** Test seam for browser/process/network boundaries; not re-exported by the package root. */
export function createWorkbenchSessionForTesting(
  config: WorkbenchSessionConfig,
  dependencies: WorkbenchSessionDependencies,
): WorkbenchSession {
  // Construction is the one validation boundary: browser-only and all required
  // host config fail before a worker or service-worker side effect is possible.
  const resolved = resolveWorkbenchConfig(config);
  const log = (line: string): void => invokeHostCallback(resolved.onLog, line);
  const capabilities = copyCapabilities(dependencies.checkCapabilities());
  const token = Symbol('workbench-session');
  const listeners = new Set<(snapshot: WorkbenchSessionSnapshot) => void>();
  let status: WorkbenchSessionStatus = 'idle';
  let storage: WorkbenchStorageSnapshot = {
    backend: null,
    degraded: false,
    persistence: null,
  };
  let serviceWorkerError: string | null = null;
  let serviceWorkerFailure: string | null = null;
  let sessionError: string | null = null;
  let owner: WorkspaceOwnerHandle | null = null;
  let controllerSet: WorkbenchControllers | null = null;
  const controllerUnsubscribers: (() => void)[] = [];
  const controllerDisposers: (() => void)[] = [];
  let bootPromise: Promise<WorkbenchControllers> | null = null;
  let disposePromise: Promise<void> | null = null;
  let disposed = false;
  let rejectDisposed: ((error: Error) => void) | null = null;
  const disposedSignal = new Promise<never>((_resolve, reject) => {
    rejectDisposed = reject;
  });
  void disposedSignal.catch(() => {});

  const readSnapshot = (): WorkbenchSessionSnapshot => ({
    status,
    capabilities: copyCapabilities(capabilities),
    storage: { ...storage },
    serviceWorkerError,
    error: sessionError,
  });

  const notify = (): void => {
    const snapshot = readSnapshot();
    notifySubscribers(listeners, snapshot);
  };

  const assertAlive = (): void => {
    if (disposed) throw new Error('workbench session disposed');
  };

  const claim = (): void => {
    if (activeSessionToken !== null && activeSessionToken !== token) {
      throw new Error(WORKBENCH_SINGLETON_ERROR);
    }
    activeSessionToken = token;
  };

  const release = (): void => {
    if (activeSessionToken === token) activeSessionToken = null;
  };

  const disposeControllers = (): Error[] => {
    const errors: Error[] = [];
    for (const unsubscribe of controllerUnsubscribers.splice(0)) {
      try {
        unsubscribe();
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }
    controllerSet = null;
    for (const dispose of controllerDisposers.splice(0).reverse()) {
      try {
        dispose();
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }
    return errors;
  };

  const awaitAlive = <T>(promise: Promise<T>): Promise<T> =>
    Promise.race([promise, disposedSignal]);

  const closeOwner = async (
    current: WorkspaceOwnerHandle,
  ): Promise<{ readonly closed: boolean; readonly errors: readonly Error[] }> => {
    const errors: Error[] = [];
    try {
      current.close();
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)));
    }
    let closed = false;
    try {
      await current.closed;
      closed = true;
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)));
    }
    return { closed, errors };
  };

  const performBoot = async (): Promise<WorkbenchControllers> => {
    assertAlive();
    claim();
    status = 'booting';
    sessionError = null;
    serviceWorkerError = null;
    serviceWorkerFailure = null;
    storage = { backend: null, degraded: false, persistence: null };
    notify();

    try {
      if (!capabilities.capabilities.crossOriginIsolated) {
        throw new Error(COI_REQUIRED_MESSAGE);
      }

      let serviceWorkerStage = 'registration';
      try {
        await awaitAlive(
          dependencies.registerServiceWorker(resolved.assets.serviceWorkerUrl, {
            scope: resolved.serviceWorkerScope,
          }),
        );
        serviceWorkerStage = 'control proof';
        await awaitAlive(dependencies.proveServiceWorkerControl(resolved.previewProbeTimeoutMs));
      } catch (error) {
        if (disposed) throw error;
        serviceWorkerError = reasonOf(error);
        serviceWorkerFailure = `${serviceWorkerStage} failed: ${serviceWorkerError}`;
        log(`[workbench] service worker ${serviceWorkerFailure}\n`);
        notify();
      }

      assertAlive();
      const spec = resolveProjectSpec(resolved.project.catalog, resolved.project.templateId);
      const current = dependencies.startWorkspaceOwner({
        assets: resolved.assets,
        registry: resolved.registry,
        catalog: resolved.project.catalog,
        root: resolved.project.root,
        workspaceId: resolved.project.workspaceId,
        template: spec,
        setup: resolved.project.setup,
        slug: resolved.project.starterId,
        starter: resolved.project.starterId,
        onLog: log,
      });
      owner = current;
      await awaitAlive(current.ready);
      assertAlive();

      const backend = current.storageBackend();
      if (backend === null) {
        throw new Error('workspace owner became ready without reporting its storage backend');
      }
      let persistence: StoragePersistenceStatus;
      try {
        persistence = await awaitAlive(dependencies.probeStoragePersistence());
      } catch (error) {
        if (disposed) throw error;
        persistence = { available: false, error: reasonOf(error) };
      }
      storage = { backend, degraded: backend === 'memory', persistence };

      const terminal = createTerminalController({
        manager: createTerminalManager({ owner: current }),
        project: { spec, root: resolved.project.root, setup: resolved.project.setup },
      });
      controllerDisposers.push(() => terminal.dispose());
      const preview = createPreviewController({
        currentOwner: () => current,
        mountBridge: dependencies.mountPreviewBridge,
        proveServiceWorkerRoundTrip: async (url, init) => {
          if (serviceWorkerError !== null) {
            throw new Error(`service worker ${serviceWorkerFailure ?? serviceWorkerError}`);
          }
          const target = new URL(url, globalThis.location.href);
          if (target.origin !== globalThis.location.origin) {
            throw new Error(`preview SW proof refused cross-origin URL ${target.href}`);
          }
          return dependencies.fetch(target.href, init);
        },
        probeTimeoutMs: resolved.previewProbeTimeoutMs,
      });
      controllerDisposers.push(() => preview.dispose());
      if (serviceWorkerError !== null) {
        preview.fail(new Error(`service worker ${serviceWorkerFailure ?? serviceWorkerError}`));
      }
      const editor = createEditorController({
        currentOwner: () => current,
        storageBackend: backend,
      });
      controllerDisposers.push(() => editor.dispose());
      const files = createFilesController({
        root: resolved.project.root,
        storageBackend: backend,
        currentOwner: () => current,
        subscribeSnapshots: (listener) =>
          dependencies.subscribeSnapshot(current.snapshotPort, listener),
        requestSnapshot: () => dependencies.requestSnapshot(current.snapshotPort),
      });
      controllerDisposers.push(() => files.dispose());
      const nextControllers: WorkbenchControllers = { terminal, preview, editor, files };
      controllerSet = nextControllers;
      controllerUnsubscribers.push(terminal.subscribe(notify));
      controllerUnsubscribers.push(preview.subscribe(notify));
      controllerUnsubscribers.push(editor.subscribe(notify));
      controllerUnsubscribers.push(files.subscribe(notify));
      status = 'ready';
      notify();

      void current.closed.then((code) => {
        if (disposed || owner !== current) return;
        const cleanupErrors = disposeControllers();
        owner = null;
        status = 'error';
        sessionError = [
          `workspace owner exited (code ${code ?? 'null'})`,
          ...cleanupErrors.map((error) => error.message),
        ].join('; ');
        release();
        notify();
      });
      return nextControllers;
    } catch (error) {
      const cleanupErrors = disposeControllers();
      const failedOwner = owner;
      owner = null;
      let ownerClosed = failedOwner === null;
      if (failedOwner) {
        const closeResult = await closeOwner(failedOwner);
        ownerClosed = closeResult.closed;
        for (const closeError of closeResult.errors) {
          cleanupErrors.push(closeError);
          log(`[workbench] owner teardown failed: ${closeError.message}\n`);
        }
      }
      // Once dispose starts it owns the claim until it has observed owner exit.
      if (ownerClosed && !disposed) release();
      if (!disposed) {
        status = 'error';
        sessionError = reasonOf(error);
        notify();
      }
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          [error, ...cleanupErrors],
          [reasonOf(error), ...cleanupErrors.map((failure) => failure.message)].join('; '),
        );
      }
      throw error;
    }
  };

  return {
    snapshot: readSnapshot,
    subscribe(listener) {
      assertAlive();
      listeners.add(listener);
      notifySubscribers([listener], readSnapshot());
      return () => listeners.delete(listener);
    },
    boot() {
      assertAlive();
      if (status === 'ready' && controllerSet) return Promise.resolve(controllerSet);
      if (bootPromise) return bootPromise;
      // Publish the attempt before performBoot can synchronously notify listeners.
      const attempt = Promise.resolve().then(performBoot);
      bootPromise = attempt;
      void attempt.then(
        () => {
          if (bootPromise === attempt) bootPromise = null;
        },
        () => {
          if (bootPromise === attempt) bootPromise = null;
        },
      );
      return attempt;
    },
    controllers() {
      assertAlive();
      if (!controllerSet || status !== 'ready') {
        throw new Error('workbench session has not booted successfully');
      }
      return controllerSet;
    },
    dispose() {
      if (disposePromise) return disposePromise;
      disposePromise = (async () => {
        if (disposed) return;
        disposed = true;
        status = 'disposed';
        rejectDisposed?.(new Error('workbench session disposed'));
        rejectDisposed = null;
        const cleanupErrors = disposeControllers();
        const current = owner;
        owner = null;
        notify();
        listeners.clear();
        let ownerClosed = current === null;
        if (current) {
          const closeResult = await closeOwner(current);
          ownerClosed = closeResult.closed;
          cleanupErrors.push(...closeResult.errors);
        }
        if (ownerClosed) release();
        if (cleanupErrors.length > 0) {
          throw new AggregateError(
            cleanupErrors,
            cleanupErrors.map((error) => error.message).join('; '),
          );
        }
      })();
      return disposePromise;
    },
  };
}
