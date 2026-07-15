import { NotImplementedError } from '@riftydev/io';
import {
  type SpawnWorkerSpec,
  type WorkerProcessHandle,
  globalProcessManager,
  isSabIpcSupported,
  setKernelWorkerUrl,
} from '@riftydev/kernel';
import { wirePreviewBridge } from '../glue/preview-port-wiring.ts';
import { createPtyClient } from '../glue/pty-client.ts';
import type { OwnerToPageFrame, PageToOwnerFrame, PtyPreview } from '../glue/pty-protocol.ts';
import type { OwnerStorageSnapshot } from '../workers/owner-storage.ts';
import { ClosedHandleError, ProjectBusyError, deserializeWorkbenchOwnerError } from './errors.ts';
import {
  createNodeCliProjectRuntime,
  createNodeServerProjectRuntime,
} from './node-project-runtime.ts';
import {
  type OwnerProjectToken,
  type PageToWorkbenchOwnerMessage,
  type WorkbenchOwnerBootConfig,
  type WorkbenchOwnerToPageMessage,
  inspectPageToWorkbenchOwnerMessage,
  inspectWorkbenchOwnerToPageMessage,
} from './owner-protocol.ts';
import {
  type PreviewAdvertisement,
  type PreviewHandle,
  createPreviewReadiness,
} from './preview-readiness.ts';
import { type InspectedProjectDefinition, projectDefinitionWire } from './project-definition.ts';
import { type ProjectSession, createProjectSession } from './project-session.ts';
import {
  type ProjectTerminal,
  type ProjectTerminalExecOptions,
  type ProjectTerminalPort,
  createProjectTerminal,
} from './project-terminal.ts';
import {
  type ServiceWorkerControlContainer,
  type ServiceWorkerControlTimers,
  proveRiftyServiceWorkerControl,
} from './service-worker-control.ts';
import { createViteProjectRuntime } from './vite-project-runtime.ts';
import {
  type RawWorkspaceOwnerHandle,
  type WorkbenchOwnerPort,
  type WorkbenchOwnerStartInput,
  createWorkbenchOwnerPort,
} from './workbench-owner-port.ts';

interface BrowserOwnerDependencies {
  readonly spawnOwner: (input: WorkbenchOwnerStartInput) => WorkerProcessHandle;
  readonly serviceWorker: ServiceWorkerControlContainer;
  readonly timers: ServiceWorkerControlTimers;
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  readonly mountPreview: typeof wirePreviewBridge;
  readonly operationId: () => string;
}

interface OpenedProject {
  readonly projectToken: OwnerProjectToken;
  readonly projectRoot: string;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: Error) => void;
  readonly settled: () => boolean;
}

type PendingOperation =
  | (Deferred<OpenedProject> & { readonly kind: 'open' })
  | (Deferred<void> & { readonly kind: 'close'; readonly projectToken: OwnerProjectToken })
  | (Deferred<void> & { readonly kind: 'delete'; readonly id: string });

interface ProjectTransport {
  readonly token: OwnerProjectToken;
  readonly projectRoot: string;
  readonly pty: ReturnType<typeof createPtyClient>;
  readonly terminalPort: ProjectTerminalPort;
  readonly subscribePreview: (
    listener: (entries: readonly PreviewAdvertisement[]) => void,
  ) => () => void;
  readonly requestPreview: () => void;
  acceptPty(frame: OwnerToPageFrame): void;
  acceptPreview(frame: PtyPreview): void;
  disconnect(): void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: Error) => void;
  let isSettled = false;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  void promise.catch(() => {});
  return {
    promise,
    resolve(value) {
      if (isSettled) return;
      isSettled = true;
      resolvePromise(value);
    },
    reject(error) {
      if (isSettled) return;
      isSettled = true;
      rejectPromise(error);
    },
    settled: () => isSettled,
  };
}

function errorFrom(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function createOperationId(): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error('Workbench owner operations require cryptographic randomUUID support');
  }
  return globalThis.crypto.randomUUID();
}

function browserDependencies(): BrowserOwnerDependencies {
  return {
    spawnOwner: spawnBrowserOwner,
    serviceWorker: navigator.serviceWorker,
    timers: {
      setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
      clearTimeout: (timerId) => window.clearTimeout(timerId),
    },
    fetch: (url, init) => globalThis.fetch(url, init),
    mountPreview: wirePreviewBridge,
    operationId: createOperationId,
  };
}

function spawnBrowserOwner(input: WorkbenchOwnerStartInput): WorkerProcessHandle {
  if (!isSabIpcSupported()) {
    throw new NotImplementedError(
      'workbench.open',
      'requires SAB IPC and a cross-origin-isolated browser tab',
    );
  }
  setKernelWorkerUrl(input.deployment.workers.kernel);
  const handle = globalProcessManager.spawnWorker(
    'workbench-owner',
    workbenchOwnerSpawnSpec(input),
    1,
    { cwd: '/' },
  );
  if (handle.kind !== 'worker') {
    throw new NotImplementedError('workbench.owner.worker', `spawnWorker returned ${handle.kind}`);
  }
  return handle;
}

/** Deployment chooses the entry; owner/project identity never enters guest env. */
export function workbenchOwnerSpawnSpec(input: WorkbenchOwnerStartInput): SpawnWorkerSpec {
  return Object.freeze({
    entry: Object.freeze({ kind: 'url' as const, url: input.deployment.workers.owner }),
    argv: Object.freeze(['rifty', 'workbench-owner']),
    env: Object.freeze({}),
    cwd: '/',
    serve: false,
  });
}

/** Browser composition: one physical owner, then typed control IPC only. */
export function createBrowserWorkbenchOwnerPort(
  dependencies?: BrowserOwnerDependencies,
): WorkbenchOwnerPort {
  return createWorkbenchOwnerPort({
    startWorkspaceOwner: (input) =>
      startBrowserWorkspaceOwner(input, dependencies ?? browserDependencies()),
  });
}

export function startBrowserWorkspaceOwner(
  input: WorkbenchOwnerStartInput,
  dependencies: BrowserOwnerDependencies,
): RawWorkspaceOwnerHandle {
  const worker = dependencies.spawnOwner(input);
  const readyState = deferred<void>();
  const closedState = deferred<void>();
  const pending = new Map<string, PendingOperation>();
  let storage: OwnerStorageSnapshot | null = null;
  let activeProject: ProjectTransport | null = null;
  let terminalSequence = 0;
  let exited = false;
  let closeRequested = false;
  let protocolFailure: Error | null = null;

  const ownerClosed = closedState.promise;

  const rejectPending = (error: Error): void => {
    for (const operation of pending.values()) operation.reject(error);
    pending.clear();
  };

  const failProtocol = (failure: unknown): void => {
    if (protocolFailure !== null) return;
    protocolFailure = errorFrom(failure);
    readyState.reject(protocolFailure);
    rejectPending(protocolFailure);
    activeProject?.disconnect();
    if (!exited) worker.kill('SIGTERM');
  };

  const send = (message: PageToWorkbenchOwnerMessage): void => {
    if (exited || protocolFailure !== null) {
      throw new ClosedHandleError('Workbench owner transport', protocolFailure ?? 'owner exited');
    }
    const owned = inspectPageToWorkbenchOwnerMessage(message);
    if (!worker.send(owned)) {
      throw new ClosedHandleError('Workbench owner transport', 'IPC send was refused');
    }
  };

  const request = <T>(
    operation: PendingOperation,
    message: PageToWorkbenchOwnerMessage,
  ): Promise<T> => {
    const opId = 'opId' in message ? message.opId : null;
    if (opId === null) return Promise.reject(new TypeError('Owner operation requires opId'));
    pending.set(opId, operation);
    try {
      send(message);
    } catch (error) {
      pending.delete(opId);
      operation.reject(errorFrom(error));
    }
    return operation.promise as Promise<T>;
  };

  const takePending = <K extends PendingOperation['kind']>(
    opId: string,
    kind: K,
  ): Extract<PendingOperation, { readonly kind: K }> => {
    const operation = pending.get(opId);
    if (operation === undefined || operation.kind !== kind) {
      throw new Error(`Unexpected Workbench owner ${kind} response for ${opId}`);
    }
    pending.delete(opId);
    return operation as Extract<PendingOperation, { readonly kind: K }>;
  };

  const acceptMessage = (raw: unknown): void => {
    let message: WorkbenchOwnerToPageMessage;
    try {
      message = inspectWorkbenchOwnerToPageMessage(raw);
    } catch (error) {
      failProtocol(error);
      return;
    }
    try {
      switch (message.type) {
        case 'workbench:owner-ready':
          if (storage !== null || readyState.settled()) {
            throw new Error('Workbench owner sent duplicate readiness');
          }
          storage = message.storage;
          readyState.resolve(undefined);
          return;
        case 'workbench:project-opened': {
          const operation = takePending(message.opId, 'open');
          operation.resolve({
            projectToken: message.projectToken,
            projectRoot: message.projectRoot,
          });
          return;
        }
        case 'workbench:project-closed': {
          const operation = takePending(message.opId, 'close');
          if (operation.projectToken !== message.projectToken) {
            throw new Error(`Workbench project close token mismatch for ${message.opId}`);
          }
          operation.resolve(undefined);
          return;
        }
        case 'workbench:project-deleted': {
          const operation = takePending(message.opId, 'delete');
          if (operation.id !== message.id) {
            throw new Error(`Workbench project delete id mismatch for ${message.opId}`);
          }
          operation.resolve(undefined);
          return;
        }
        case 'workbench:project-pty':
          if (activeProject?.token !== message.projectToken) {
            throw new Error('Workbench owner sent PTY data for a retired project');
          }
          activeProject.acceptPty(message.frame);
          return;
        case 'workbench:project-preview':
          if (activeProject?.token !== message.projectToken) {
            throw new Error('Workbench owner sent preview data for a retired project');
          }
          activeProject.acceptPreview(message.frame);
          return;
        case 'workbench:failure': {
          const error = deserializeWorkbenchOwnerError(message.error);
          if (!('opId' in message)) {
            failProtocol(error);
            return;
          }
          const operation = pending.get(message.opId);
          if (operation === undefined) {
            throw new Error(`Unexpected Workbench owner failure for ${message.opId}`);
          }
          pending.delete(message.opId);
          operation.reject(error);
          return;
        }
      }
    } catch (error) {
      failProtocol(error);
    }
  };

  worker.on('message', acceptMessage);
  worker.on('messageerror', (event: unknown) => {
    failProtocol(new Error(`Workbench owner IPC messageerror: ${String(event)}`));
  });
  worker.on('exit', (rawCode?: unknown, rawSignal?: unknown) => {
    if (exited) return;
    exited = true;
    const code = typeof rawCode === 'number' ? rawCode : null;
    const signal = typeof rawSignal === 'string' ? rawSignal : null;
    const normal = closeRequested && code === 0 && signal === null && protocolFailure === null;
    const exitError =
      protocolFailure ??
      new Error(
        `Workbench owner exited${closeRequested ? '' : ' unexpectedly'} ` +
          `(code ${String(code)}, signal ${String(signal)})`,
      );
    readyState.reject(exitError);
    rejectPending(exitError);
    activeProject?.disconnect();
    if (normal) closedState.resolve(undefined);
    else closedState.reject(exitError);
  });

  const bootConfig: WorkbenchOwnerBootConfig = Object.freeze({
    deployment: Object.freeze({
      workers: Object.freeze({
        kernel: input.deployment.workers.kernel,
        node: input.deployment.workers.node,
        devServer: input.deployment.workers.devServer,
      }),
      wasm: Object.freeze({
        sqlite: input.deployment.wasm.sqlite,
        esbuild: input.deployment.wasm.esbuild,
      }),
      previewProbeTimeoutMs: input.deployment.previewProbeTimeoutMs,
    }),
    packageAcquisition: input.packageAcquisition,
    storage: input.storage,
  });
  try {
    send({ type: 'workbench:initialize', config: bootConfig });
  } catch (error) {
    failProtocol(error);
  }

  const requestCloseProject = (projectToken: OwnerProjectToken): Promise<void> => {
    const opId = dependencies.operationId();
    const operation = { ...deferred<void>(), kind: 'close' as const, projectToken };
    return request<void>(operation, {
      type: 'workbench:close-project',
      opId,
      projectToken,
    });
  };

  const makeProjectTransport = (opened: OpenedProject): ProjectTransport => {
    let disconnected = false;
    let currentPreview: readonly PreviewAdvertisement[] = Object.freeze([]);
    const previewListeners = new Set<(entries: readonly PreviewAdvertisement[]) => void>();

    const assertCurrent = (): void => {
      if (disconnected || exited || activeProject?.token !== opened.projectToken) {
        throw new ClosedHandleError('Workbench project transport');
      }
    };

    const pty = createPtyClient({
      send: (frame: PageToOwnerFrame) => {
        assertCurrent();
        if (frame.type === 'pty:preview-req') {
          send({
            type: 'workbench:project-preview',
            projectToken: opened.projectToken,
            frame,
          });
        } else {
          send({
            type: 'workbench:project-pty',
            projectToken: opened.projectToken,
            frame,
          });
        }
      },
      onPreview: (frame) => {
        currentPreview = Object.freeze(
          frame.ports.map((entry): PreviewAdvertisement => {
            const base = {
              ownerToken: opened.projectToken,
              port: entry.port,
              url: entry.url,
              source: entry.source,
              sid: entry.sid,
              ...(entry.previewScope === undefined ? {} : { previewScope: entry.previewScope }),
            } as const;
            return entry.ptySid === undefined || entry.ptyRid === undefined
              ? Object.freeze(base)
              : Object.freeze({ ...base, ptySid: entry.ptySid, ptyRid: entry.ptyRid });
          }),
        );
        for (const listener of [...previewListeners]) listener(currentPreview);
      },
    });

    const terminalPort = Object.freeze({
      closed: ownerClosed,
      isAlive: () => !disconnected && !exited && activeProject?.token === opened.projectToken,
      openSession: (sid: string) => pty.openSession(sid, { cwd: opened.projectRoot }),
      execResult: (sid: string, line: string, options: ProjectTerminalExecOptions) =>
        pty.execResult(sid, line, options),
      writeStdin: (sid: string, rid: string, data: Uint8Array) => pty.writeStdin(sid, rid, data),
      endStdin: (sid: string, rid: string) => pty.endStdin(sid, rid),
      resizeSession: (sid: string, cols: number, rows: number) =>
        pty.resizeSession(sid, cols, rows),
      resize: (sid: string, rid: string, cols: number, rows: number) =>
        pty.resize(sid, rid, cols, rows),
      signal: (sid: string, rid: string) => pty.signal(sid, rid),
      closeSession: (sid: string, cancellation?: Error) => pty.closeSession(sid, cancellation),
    }) satisfies ProjectTerminalPort;

    return {
      token: opened.projectToken,
      projectRoot: opened.projectRoot,
      pty,
      terminalPort,
      subscribePreview(listener) {
        assertCurrent();
        previewListeners.add(listener);
        listener(currentPreview);
        return () => previewListeners.delete(listener);
      },
      requestPreview: () => pty.requestPreview(),
      acceptPty: (frame) => pty.onFrame(frame),
      acceptPreview: (frame) => pty.onFrame(frame),
      disconnect() {
        if (disconnected) return;
        disconnected = true;
        currentPreview = Object.freeze([]);
        for (const listener of [...previewListeners]) listener(currentPreview);
        previewListeners.clear();
        pty.disconnect();
      },
    };
  };

  const createBrowserProject = <TReady>(
    transport: ProjectTransport,
    definition: InspectedProjectDefinition<TReady>,
  ): ProjectSession<TReady> => {
    const openTerminal = (): ProjectTerminal =>
      createProjectTerminal({
        id: `workbench-terminal-${String(++terminalSequence)}`,
        port: transport.terminalPort,
      });
    const terminal = openTerminal();
    const previewReadiness = () =>
      createPreviewReadiness({
        timeoutMs: input.deployment.previewProbeTimeoutMs,
        subscribe: transport.subscribePreview,
        requestSnapshot: transport.requestPreview,
        mountRoute: (entry) =>
          dependencies.mountPreview(entry.port, entry.ownerToken, entry.previewScope),
        proveServiceWorkerControl: (signal) =>
          proveRiftyServiceWorkerControl({
            container: dependencies.serviceWorker,
            timeoutMs: input.deployment.previewProbeTimeoutMs,
            signal,
            timers: dependencies.timers,
          }),
        probe: async (url, signal) => {
          const response = await dependencies.fetch(url, {
            cache: 'no-store',
            signal,
          });
          return { ok: response.ok, status: response.status };
        },
      });

    const bindOwnerClose = <T>(core: ProjectSession<T>): ProjectSession<T> => {
      let closePromise: Promise<void> | null = null;
      return Object.freeze({
        run: () => core.run(),
        terminals: core.terminals,
        close() {
          if (closePromise !== null) return closePromise;
          // PTY close frames enter the ordered channel before the owner token is
          // fenced by close-project; the ACK still waits for owner-side teardown.
          const terminalClose = core.close();
          const ownerClose = requestCloseProject(transport.token);
          closePromise = (async () => {
            const results = await Promise.allSettled([terminalClose, ownerClose]);
            const failures = results.flatMap((result) =>
              result.status === 'rejected' ? [errorFrom(result.reason)] : [],
            );
            transport.disconnect();
            if (activeProject === transport) activeProject = null;
            if (failures.length === 1) throw failures[0] as Error;
            if (failures.length > 1) {
              throw new AggregateError(
                failures,
                `Workbench project close failed: ${failures.map((error) => error.message).join('; ')}`,
              );
            }
          })();
          void closePromise.catch(() => {});
          return closePromise;
        },
      });
    };

    const session =
      definition.kind === 'node-cli'
        ? bindOwnerClose(
            createProjectSession<void>({
              runtime: createNodeCliProjectRuntime({
                terminal,
                entryPath: definition.entryPath,
                args: definition.args,
              }),
              terminal,
              createTerminal: openTerminal,
            }),
          )
        : bindOwnerClose(
            createProjectSession<PreviewHandle>({
              runtime:
                definition.kind === 'node-server'
                  ? createNodeServerProjectRuntime({
                      terminal,
                      ownerToken: transport.token,
                      entryPath: definition.entryPath,
                      port: definition.port,
                      createPreviewReadiness: previewReadiness,
                    })
                  : createViteProjectRuntime({
                      terminal,
                      ownerToken: transport.token,
                      createPreviewReadiness: previewReadiness,
                    }),
              terminal,
              createTerminal: openTerminal,
            }),
          );
    // ProjectDefinition<TReady> is package-branded; the exhaustive finite kind
    // dispatch above is the sole place that maps its phantom readiness type.
    return session as ProjectSession<TReady>;
  };

  return {
    ready: readyState.promise,
    closed: ownerClosed,
    storageSnapshot() {
      if (storage === null || !readyState.settled()) {
        throw new Error('Workbench owner storage is unavailable before readiness');
      }
      return storage;
    },
    async openProject<TReady>(definition: InspectedProjectDefinition<TReady>) {
      if (activeProject !== null) throw new ProjectBusyError('Workbench owner project');
      const opId = dependencies.operationId();
      const operation = { ...deferred<OpenedProject>(), kind: 'open' as const };
      const opened = await request<OpenedProject>(operation, {
        type: 'workbench:open-project',
        opId,
        definition: projectDefinitionWire(definition),
      });
      const transport = makeProjectTransport(opened);
      activeProject = transport;
      try {
        return createBrowserProject<TReady>(transport, definition);
      } catch (error) {
        const failures = [errorFrom(error)];
        try {
          await requestCloseProject(opened.projectToken);
        } catch (closeError) {
          failures.push(errorFrom(closeError));
        }
        transport.disconnect();
        if (activeProject === transport) activeProject = null;
        if (failures.length === 1) throw failures[0] as Error;
        throw new AggregateError(failures, 'Workbench project construction and cleanup failed');
      }
    },
    deleteProject(id: string) {
      if (activeProject !== null) {
        return Promise.reject(new ProjectBusyError('Workbench owner project'));
      }
      const opId = dependencies.operationId();
      const operation = { ...deferred<void>(), kind: 'delete' as const, id };
      return request<void>(operation, { type: 'workbench:delete-project', opId, id });
    },
    close() {
      if (closeRequested || exited) return;
      closeRequested = true;
      try {
        send({ type: 'workbench:shutdown' });
      } catch (error) {
        if (protocolFailure === null) protocolFailure = errorFrom(error);
        worker.kill('SIGTERM');
      }
    },
  };
}
