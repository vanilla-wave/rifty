import { observeProcessTerminalOutcome } from '@riftydev/kernel';
import { createPtyClient } from '../glue/pty-client.ts';
import type { OwnerToPageFrame, PageToOwnerFrame, PtyPreview } from '../glue/pty-protocol.ts';
import type { OwnerStorageSnapshot } from '../workers/owner-storage.ts';
import { ClosedHandleError, ProjectBusyError, deserializeWorkbenchOwnerError } from './errors.ts';
import {
  type PageToPlaygroundOwnerMessage,
  type PlaygroundCatalogCommand,
  type PlaygroundOwnerToPageMessage,
  type PlaygroundProjectRuntimeDecision,
  inspectPageToPlaygroundOwnerMessage,
  inspectPlaygroundOwnerToPageMessage,
  isPageToPlaygroundOwnerMessage,
  isPlaygroundOwnerToPageMessage,
} from './internal/playground-owner-protocol.ts';
import {
  type BrowserPlaygroundPreviewAuthority,
  createBrowserPlaygroundPreviewAuthority,
} from './internal/playground-preview-registry.ts';
import {
  type InspectedPlaygroundProjectDefinition,
  inspectPlaygroundProjectDefinition,
  playgroundProjectDefinitionWire,
} from './internal/playground-project-definition.ts';
import {
  type BrowserPlaygroundSessionToolsLifecycle,
  type OwnerPlaygroundSessionToolsFrame,
  type PlaygroundSessionToolsOperationalHealth,
  createBrowserPlaygroundSessionTools,
  operationalHealthForScmSnapshot,
} from './internal/playground-session-tools-transport.ts';
import {
  ownPlaygroundProjectOpenOptions,
  projectTerminalStateFromOwner,
} from './internal/playground-terminal-state.ts';
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
import type {
  PlaygroundCatalogSnapshot,
  PlaygroundProjectCatalog,
  PlaygroundProjectOpenOptions,
  PlaygroundScmSnapshot,
} from './playground.ts';
import {
  type PreviewAdvertisement,
  type PreviewHandle,
  createPreviewReadiness,
} from './preview-readiness.ts';
import {
  type ProjectContentTransport,
  createProjectContentTransport,
} from './project-content-transport.ts';
import type { ProjectContentController } from './project-content.ts';
import {
  type InspectedProjectDefinition,
  type ProjectDefinition,
  projectDefinitionWire,
} from './project-definition.ts';
import { toOwnerProjectPath } from './project-file-boundary.ts';
import type { ProjectAcquisitionPlan } from './project-materialization.ts';
import { type ProjectSession, createProjectSession } from './project-session.ts';
import {
  type ProjectTerminal,
  type ProjectTerminalExecOptions,
  type ProjectTerminalPort,
  type ProjectTerminalPortState,
  type ProjectTerminalSnapshot,
  createProjectTerminal,
} from './project-terminal.ts';
import { proveRiftyServiceWorkerControl } from './service-worker-control.ts';
import { createViteProjectRuntime } from './vite-project-runtime.ts';
import {
  type BrowserOwnerDependencies,
  browserDependencies,
} from './workbench-browser-owner-spawn.ts';
import {
  type PlaygroundOwnerOperationalHealth,
  type PlaygroundOwnerSessionToolLifecycle,
  type RawWorkspaceOwnerHandle,
  type WorkbenchOwnerHealthEvent,
  type WorkbenchOwnerPort,
  type WorkbenchOwnerStartInput,
  createWorkbenchOwnerPort,
} from './workbench-owner-port.ts';

const PROJECT_VFS_COMMIT_TIMEOUT_MS = 60_000;
/** ADR-0360: shipped budget of owner durability-progress SILENCE, not of total
 *  operation duration. One authority for the default; hosts override it with
 *  `deployment.ownerOperationSilenceTimeoutMs`. */
const OWNER_OPERATION_SILENCE_TIMEOUT_MS = 60_000;

interface OpenedProject {
  readonly projectToken: OwnerProjectToken;
  readonly projectRoot: string;
}

interface OpenedPlaygroundProject extends OpenedProject {
  readonly acquisition: ProjectAcquisitionPlan;
  readonly runtime: PlaygroundProjectRuntimeDecision;
  readonly initialScmSnapshot: PlaygroundScmSnapshot;
  readonly initialTerminalState?: ProjectTerminalSnapshot;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: Error) => void;
  readonly settled: () => boolean;
}

type PendingOperation =
  | (Deferred<OpenedProject> & { readonly kind: 'open' })
  | (Deferred<OpenedPlaygroundProject> & { readonly kind: 'playground-open' })
  | (Deferred<PlaygroundCatalogSnapshot> & { readonly kind: 'playground-catalog' })
  | (Deferred<void> & { readonly kind: 'close'; readonly projectToken: OwnerProjectToken })
  | (Deferred<void> & { readonly kind: 'delete'; readonly id: string });

type PageToPhysicalOwnerMessage = PageToWorkbenchOwnerMessage | PageToPlaygroundOwnerMessage;

interface ProjectTransport {
  readonly token: OwnerProjectToken;
  readonly projectRoot: string;
  readonly content: ProjectContentTransport;
  readonly pty: ReturnType<typeof createPtyClient>;
  readonly terminalPort: ProjectTerminalPort;
  readonly previews: BrowserPlaygroundPreviewAuthority;
  playgroundScmSnapshot(): PlaygroundScmSnapshot;
  playgroundOperationalHealth(): PlaygroundSessionToolsOperationalHealth;
  subscribeOperationalHealth(
    listener: (health: PlaygroundOwnerOperationalHealth) => void,
  ): () => void;
  subscribePlaygroundTools(listener: (frame: unknown) => void): () => void;
  acceptPty(frame: OwnerToPageFrame): void;
  acceptPreview(frame: PtyPreview): void;
  acceptVfs(frame: WorkbenchOwnerToPageMessage & { readonly type: 'workbench:project-vfs' }): void;
  acceptPlaygroundTools(frame: OwnerPlaygroundSessionToolsFrame): void;
  disconnect(error?: Error): void;
}

interface PlaygroundSessionState {
  readonly transport: ProjectTransport;
  readonly content: ProjectContentController;
  lifecycle: PlaygroundOwnerSessionToolLifecycle | null;
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
  const ownerStderrDecoder = new TextDecoder();
  let ownerStderr = '';
  worker.stderr().on('data', (chunk: unknown) => {
    if (!(chunk instanceof Uint8Array)) return;
    ownerStderr = `${ownerStderr}${ownerStderrDecoder.decode(chunk, { stream: true })}`.slice(
      -16_384,
    );
  });
  const silenceBudgetMs =
    input.deployment.ownerOperationSilenceTimeoutMs ?? OWNER_OPERATION_SILENCE_TIMEOUT_MS;
  const playgroundUrlContext = input.playgroundUrlContext;
  const companionMode = playgroundUrlContext !== undefined;
  const readyState = deferred<void>();
  const closedState = deferred<void>();
  const pending = new Map<string, PendingOperation>();
  const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const catalogListeners = new Set<(snapshot: PlaygroundCatalogSnapshot) => void>();
  const healthListeners = new Set<(event: WorkbenchOwnerHealthEvent) => void>();
  const playgroundSessions = new WeakMap<object, PlaygroundSessionState>();
  let storage: OwnerStorageSnapshot | null = null;
  let catalogSnapshot: PlaygroundCatalogSnapshot | null = null;
  let playgroundReady = false;
  let activeProject: ProjectTransport | null = null;
  let terminalSequence = 0;
  let exited = false;
  let closeRequested = false;
  let protocolFailure: Error | null = null;
  let invariantHealth: WorkbenchOwnerHealthEvent | null = null;

  const ownerClosed = closedState.promise;

  const resolveReady = (): void => {
    if (storage !== null && (!companionMode || playgroundReady)) {
      readyState.resolve(undefined);
    }
  };

  const currentCatalog = (): PlaygroundCatalogSnapshot => {
    if (catalogSnapshot === null || !playgroundReady) {
      throw new Error('Playground catalog is unavailable before readiness');
    }
    return catalogSnapshot;
  };

  const publishCatalog = (snapshot: PlaygroundCatalogSnapshot): void => {
    catalogSnapshot = snapshot;
    for (const listener of [...catalogListeners]) {
      try {
        listener(snapshot);
      } catch {
        // One page consumer cannot invalidate an already-owner-committed catalog.
      }
    }
  };

  const rejectPending = (error: Error): void => {
    for (const operation of pending.values()) operation.reject(error);
    pending.clear();
    for (const timer of pendingTimers.values()) clearTimeout(timer);
    pendingTimers.clear();
  };

  const failProtocol = (failure: unknown): void => {
    if (protocolFailure !== null) return;
    protocolFailure = errorFrom(failure);
    readyState.reject(protocolFailure);
    rejectPending(protocolFailure);
    if (!exited) worker.kill('SIGTERM');
  };

  const failInvariant = (failure: unknown): void => {
    if (protocolFailure !== null) return;
    invariantHealth ??= Object.freeze({
      kind: 'fatal-invariant',
      summary: 'Workbench protocol invariant failed',
    });
    for (const listener of [...healthListeners]) {
      try {
        listener(invariantHealth);
      } catch {
        // Health observation cannot replace the authoritative protocol failure.
      }
    }
    failProtocol(failure);
  };

  const publishHealth = (event: WorkbenchOwnerHealthEvent): void => {
    for (const listener of [...healthListeners]) {
      try {
        listener(event);
      } catch {
        // Health observation cannot replace owner or project state.
      }
    }
  };

  const send = (message: PageToPhysicalOwnerMessage): void => {
    if (exited || protocolFailure !== null) {
      throw new ClosedHandleError('Workbench owner transport', protocolFailure ?? 'owner exited');
    }
    const owned = isPageToPlaygroundOwnerMessage(message)
      ? playgroundUrlContext === undefined
        ? (() => {
            throw new TypeError('Playground companion owner is unavailable');
          })()
        : inspectPageToPlaygroundOwnerMessage(message, playgroundUrlContext)
      : inspectPageToWorkbenchOwnerMessage(message);
    if (!worker.send(owned)) {
      throw new ClosedHandleError('Workbench owner transport', 'IPC send was refused');
    }
  };

  const armSilenceDeadline = (opId: string, operation: PendingOperation): void => {
    const timer = setTimeout(() => {
      if (pending.get(opId) !== operation) return;
      pending.delete(opId);
      pendingTimers.delete(opId);
      const error = new Error(
        `Workbench owner ${operation.kind} operation ${opId} timed out after ${String(silenceBudgetMs)}ms without owner durability progress`,
      );
      operation.reject(error);
      failProtocol(error);
    }, silenceBudgetMs);
    pendingTimers.set(opId, timer);
  };

  /**
   * ADR-0360: a durability-progress frame proves the owner is alive and
   * flushing, so it re-arms EVERY pending operation — they share one owner and
   * one flush. Nothing else resets the deadline: an any-traffic reset would let
   * a chatty transport mask a wedged flush forever (`unbounded-read`).
   */
  const rearmSilenceDeadlines = (): void => {
    for (const [opId, operation] of pending) {
      const timer = pendingTimers.get(opId);
      if (timer !== undefined) clearTimeout(timer);
      armSilenceDeadline(opId, operation);
    }
  };

  const request = <T>(
    operation: PendingOperation,
    message: PageToPhysicalOwnerMessage,
  ): Promise<T> => {
    const opId = 'opId' in message ? message.opId : null;
    if (opId === null) return Promise.reject(new TypeError('Owner operation requires opId'));
    pending.set(opId, operation);
    armSilenceDeadline(opId, operation);
    try {
      send(message);
    } catch (error) {
      pending.delete(opId);
      const timer = pendingTimers.get(opId);
      if (timer !== undefined) clearTimeout(timer);
      pendingTimers.delete(opId);
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
    const timer = pendingTimers.get(opId);
    if (timer !== undefined) clearTimeout(timer);
    pendingTimers.delete(opId);
    return operation as Extract<PendingOperation, { readonly kind: K }>;
  };

  const acceptPlaygroundMessage = (message: PlaygroundOwnerToPageMessage): void => {
    switch (message.type) {
      case 'workbench:playground-ready':
        if (!companionMode) throw new Error('Generic Workbench owner sent Playground readiness');
        if (playgroundReady || catalogSnapshot !== null) {
          throw new Error('Workbench owner sent duplicate Playground readiness');
        }
        catalogSnapshot = message.catalog;
        playgroundReady = true;
        resolveReady();
        return;
      case 'workbench:playground-catalog-updated':
        if (!playgroundReady || catalogSnapshot === null) {
          throw new Error('Workbench owner sent a Playground catalog update before readiness');
        }
        publishCatalog(message.catalog);
        return;
      case 'workbench:playground-catalog-completed': {
        const operation = takePending(message.opId, 'playground-catalog');
        operation.resolve(currentCatalog());
        return;
      }
      case 'workbench:playground-project-opened': {
        const operation = takePending(message.opId, 'playground-open');
        operation.resolve(message);
        return;
      }
      case 'workbench:playground-project-tools':
        if (activeProject?.token !== message.projectToken) {
          throw new Error('Workbench owner sent session tools data for a retired project');
        }
        activeProject.acceptPlaygroundTools(message.frame);
    }
  };

  const acceptMessage = (raw: unknown): void => {
    if (isPlaygroundOwnerToPageMessage(raw)) {
      try {
        if (!companionMode) {
          throw new TypeError('Generic Workbench owner received a Playground companion frame');
        }
        acceptPlaygroundMessage(inspectPlaygroundOwnerToPageMessage(raw));
      } catch (error) {
        failInvariant(error);
      }
      return;
    }
    let message: WorkbenchOwnerToPageMessage;
    try {
      message = inspectWorkbenchOwnerToPageMessage(raw);
    } catch (error) {
      failInvariant(error);
      return;
    }
    try {
      switch (message.type) {
        case 'workbench:owner-ready':
          if (storage !== null) {
            throw new Error('Workbench owner sent duplicate readiness');
          }
          storage = message.storage;
          resolveReady();
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
        case 'workbench:project-vfs':
          if (activeProject?.token !== message.projectToken) {
            throw new Error('Workbench owner sent VFS data for a retired project');
          }
          activeProject.acceptVfs(message);
          return;
        case 'workbench:durability-progress':
          // Owner-level: the first-open drain predates project tokens (ADR-0359).
          // ADR-0360: arrival is the liveness proof the deadline measures.
          rearmSilenceDeadlines();
          publishHealth(
            Object.freeze({
              kind: 'durability-progress',
              persisted: message.persisted,
              total: message.total,
            }),
          );
          return;
        case 'workbench:failure': {
          const error = deserializeWorkbenchOwnerError(message.error);
          if (!('opId' in message)) {
            failInvariant(error);
            return;
          }
          const operation = pending.get(message.opId);
          if (operation === undefined) {
            throw new Error(`Unexpected Workbench owner failure for ${message.opId}`);
          }
          pending.delete(message.opId);
          const timer = pendingTimers.get(message.opId);
          if (timer !== undefined) clearTimeout(timer);
          pendingTimers.delete(message.opId);
          operation.reject(error);
          return;
        }
      }
    } catch (error) {
      failInvariant(error);
    }
  };

  worker.on('message', acceptMessage);
  worker.on('messageerror', (event: unknown) => {
    failInvariant(new Error(`Workbench owner IPC messageerror: ${String(event)}`));
  });
  observeProcessTerminalOutcome(worker, (outcome) => {
    if (exited) return;
    exited = true;
    if (outcome.kind === 'peererror') {
      const failure = protocolFailure ?? errorFrom(outcome.error);
      readyState.reject(failure);
      rejectPending(failure);
      activeProject?.disconnect(failure);
      closedState.reject(failure);
      return;
    }
    const code = typeof outcome.code === 'number' ? outcome.code : null;
    const signal = typeof outcome.signal === 'string' ? outcome.signal : null;
    const normal = closeRequested && code === 0 && signal === null && protocolFailure === null;
    const exitError =
      protocolFailure ??
      (normal
        ? new ClosedHandleError('Workbench owner')
        : new Error(
            `Workbench owner exited${closeRequested ? '' : ' unexpectedly'} (code ${String(code)}, signal ${String(signal)})${ownerStderr === '' ? '' : `\n${ownerStderr}${ownerStderrDecoder.decode()}`}`,
          ));
    readyState.reject(exitError);
    rejectPending(exitError);
    activeProject?.disconnect(exitError);
    if (normal) closedState.resolve(undefined);
    else closedState.reject(exitError);
  });

  const bootConfig: WorkbenchOwnerBootConfig = Object.freeze({
    deployment: Object.freeze({
      workers: Object.freeze({
        kernel: input.deployment.workers.kernel,
        node: input.deployment.workers.node,
        devServer: input.deployment.workers.devServer,
        ...(input.deployment.workers.typescript === undefined
          ? {}
          : { typescript: input.deployment.workers.typescript }),
      }),
      wasm: Object.freeze({
        sqlite: input.deployment.wasm.sqlite,
      }),
      previewProbeTimeoutMs: input.deployment.previewProbeTimeoutMs,
    }),
    packageAcquisition: input.packageAcquisition,
    storage: input.storage,
    ...(input.legacyWorkspacePrefix === undefined
      ? {}
      : { legacyWorkspacePrefix: input.legacyWorkspacePrefix }),
    ...(input.playgroundUrlContext === undefined
      ? {}
      : { playgroundUrlContext: input.playgroundUrlContext }),
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

  const makeProjectTransport = (
    opened: OpenedProject,
    initialScmSnapshot: PlaygroundScmSnapshot | null = null,
  ): ProjectTransport => {
    let disconnected = false;
    let currentPreview: readonly PreviewAdvertisement[] = Object.freeze([]);
    let currentScmSnapshot = initialScmSnapshot;
    let currentOperationalHealth: PlaygroundSessionToolsOperationalHealth =
      initialScmSnapshot === null
        ? Object.freeze({ scope: 'scm', status: 'healthy' })
        : operationalHealthForScmSnapshot(initialScmSnapshot);
    let currentPreviewHealth: PlaygroundOwnerOperationalHealth = Object.freeze({
      scope: 'preview',
      status: 'healthy',
    });
    const previewListeners = new Set<(entries: readonly PreviewAdvertisement[]) => void>();
    const playgroundToolListeners = new Set<(frame: unknown) => void>();
    const operationalHealthListeners = new Set<
      (health: PlaygroundOwnerOperationalHealth) => void
    >();

    const publishOperationalHealth = (health: PlaygroundOwnerOperationalHealth): void => {
      for (const listener of [...operationalHealthListeners]) {
        try {
          listener(health);
        } catch {
          // One health observer cannot suppress sibling state delivery.
        }
      }
    };

    const assertCurrent = (): void => {
      if (
        disconnected ||
        exited ||
        (activeProject !== null && activeProject.token !== opened.projectToken)
      ) {
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
              label: entry.label,
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

    const subscribeRawPreview = (
      listener: (entries: readonly PreviewAdvertisement[]) => void,
    ): (() => void) => {
      assertCurrent();
      previewListeners.add(listener);
      listener(currentPreview);
      return () => previewListeners.delete(listener);
    };
    const requestRawPreview = (): void => pty.requestPreview();
    const provePreviewControl = (signal: AbortSignal): Promise<void> =>
      proveRiftyServiceWorkerControl({
        container: dependencies.serviceWorker,
        timeoutMs: input.deployment.previewProbeTimeoutMs,
        signal,
        timers: dependencies.timers,
      });
    const previews = createBrowserPlaygroundPreviewAuthority({
      subscribe: subscribeRawPreview,
      requestSnapshot: requestRawPreview,
      mountRoute: (entry) =>
        dependencies.mountPreview(entry.port, entry.ownerToken, entry.previewScope),
      proveServiceWorkerControl: provePreviewControl,
      onDegraded(error) {
        currentPreviewHealth = Object.freeze({
          scope: 'preview',
          status: 'degraded',
          error: Object.freeze({ name: error.name, message: error.message }),
        });
        publishOperationalHealth(currentPreviewHealth);
      },
      onHealthy() {
        currentPreviewHealth = Object.freeze({ scope: 'preview', status: 'healthy' });
        publishOperationalHealth(currentPreviewHealth);
      },
      onInvariant: failInvariant,
    });

    const terminalPort = Object.freeze({
      closed: ownerClosed,
      isAlive: () => !disconnected && !exited && activeProject?.token === opened.projectToken,
      openSession: (sid: string, initialState?: ProjectTerminalPortState) =>
        pty.openSession(sid, initialState ?? { cwd: opened.projectRoot }),
      snapshot: (sid: string) =>
        projectTerminalStateFromOwner(opened.projectRoot, pty.snapshot(sid)),
      complete: (sid: string, line: string, cursor: number) => pty.complete(sid, line, cursor),
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

    const content = createProjectContentTransport({
      projectRoot: opened.projectRoot,
      send: (frame) => {
        assertCurrent();
        send({
          type: 'workbench:project-vfs',
          projectToken: opened.projectToken,
          frame,
        });
        return true;
      },
      isAlive: () =>
        !disconnected &&
        !exited &&
        (activeProject === null || activeProject.token === opened.projectToken),
      generateRequestId: dependencies.operationId,
      commitTimeoutMs: PROJECT_VFS_COMMIT_TIMEOUT_MS,
      reportProtocolError: failInvariant,
      onDurabilityState(state) {
        if (disconnected || exited || activeProject?.token !== opened.projectToken) return;
        publishHealth(
          state.status === 'proved'
            ? Object.freeze({ kind: 'persistence', status: 'healthy' })
            : Object.freeze({ kind: 'persistence', status: 'degraded', recover: state.recover }),
        );
      },
    });

    return {
      token: opened.projectToken,
      projectRoot: opened.projectRoot,
      content,
      pty,
      terminalPort,
      previews,
      playgroundScmSnapshot() {
        assertCurrent();
        if (currentScmSnapshot === null) {
          throw new TypeError('Playground session tools are unavailable for this project');
        }
        return currentScmSnapshot;
      },
      playgroundOperationalHealth() {
        assertCurrent();
        return currentOperationalHealth;
      },
      subscribeOperationalHealth(listener) {
        assertCurrent();
        if (typeof listener !== 'function') {
          throw new TypeError('Playground operational health listener must be a function');
        }
        operationalHealthListeners.add(listener);
        try {
          listener(currentOperationalHealth);
          listener(currentPreviewHealth);
        } catch {
          // Replay follows the same observer isolation as live delivery.
        }
        return () => operationalHealthListeners.delete(listener);
      },
      subscribePlaygroundTools(listener) {
        assertCurrent();
        playgroundToolListeners.add(listener);
        return () => playgroundToolListeners.delete(listener);
      },
      acceptPty: (frame) => pty.onFrame(frame),
      acceptPreview: (frame) => pty.onFrame(frame),
      acceptVfs: (message) => content.accept(message.frame),
      acceptPlaygroundTools(frame) {
        if (currentScmSnapshot === null) {
          throw new TypeError('Playground session tools are unavailable for this project');
        }
        if (frame.type === 'workbench:playground-session-tools-scm-snapshot') {
          currentScmSnapshot = frame.snapshot;
          currentOperationalHealth = operationalHealthForScmSnapshot(currentScmSnapshot);
          publishOperationalHealth(currentOperationalHealth);
        } else if (frame.type === 'workbench:playground-session-tools-operational-health') {
          currentOperationalHealth = frame.health;
          publishOperationalHealth(currentOperationalHealth);
        }
        for (const listener of [...playgroundToolListeners]) {
          try {
            listener(frame);
          } catch {
            // The semantic session-tools transport owns listener failure state.
          }
        }
      },
      disconnect(error) {
        if (disconnected) return;
        disconnected = true;
        void previews.close().catch(() => {});
        currentPreview = Object.freeze([]);
        for (const listener of [...previewListeners]) listener(currentPreview);
        previewListeners.clear();
        const toolsFailure = error ?? new ClosedHandleError('Workbench project transport');
        for (const listener of [...playgroundToolListeners]) {
          try {
            listener(toolsFailure);
          } catch {
            // Disconnect is already authoritative; consumer failure cannot reopen it.
          }
        }
        playgroundToolListeners.clear();
        operationalHealthListeners.clear();
        pty.disconnect(error);
        content.disconnect(error);
      },
    };
  };

  const createBrowserProject = <TReady>(
    transport: ProjectTransport,
    definition: InspectedProjectDefinition<TReady>,
    content: ProjectContentController,
    companion?: Pick<OpenedPlaygroundProject, 'acquisition' | 'runtime' | 'initialTerminalState'>,
  ): ProjectSession<TReady> => {
    const ownerInitialTerminalState =
      companion?.initialTerminalState === undefined
        ? undefined
        : Object.freeze({
            cwd: toOwnerProjectPath(transport.projectRoot, companion.initialTerminalState.cwd, {
              allowRoot: true,
            }),
            env: companion.initialTerminalState.env,
          });
    const openTerminal = (): ProjectTerminal => {
      return createProjectTerminal({
        id: `workbench-terminal-${String(++terminalSequence)}`,
        port: transport.terminalPort,
        ...(ownerInitialTerminalState === undefined
          ? {}
          : { initialState: ownerInitialTerminalState }),
      });
    };
    const terminal = openTerminal();
    const previewReadiness = () =>
      createPreviewReadiness({
        timeoutMs: input.deployment.previewProbeTimeoutMs,
        subscribe: transport.previews.subscribeRouted,
        requestSnapshot: transport.previews.requestSnapshot,
        // The registry admits only already-mounted, SW-control-proven routes.
        // Readiness observes that authority, adds only HTTP proof, then composes
        // the same route-operation barrier on run retirement.
        mountRoute: () => () => {},
        proveServiceWorkerControl: () => transport.previews.settleRoutes(),
        probe: async (url, signal) => {
          const response = await dependencies.fetch(url, {
            cache: 'no-store',
            signal,
          });
          return { ok: response.ok, status: response.status };
        },
      });

    const closeOwner = async (): Promise<void> => {
      const failures: Error[] = [];
      let ownerCloseFailed = false;
      try {
        await requestCloseProject(transport.token);
      } catch (error) {
        ownerCloseFailed = true;
        failures.push(errorFrom(error));
      }
      if (ownerCloseFailed) {
        if (!exited) worker.kill('SIGTERM');
        await ownerClosed.catch(() => {});
      }
      try {
        await transport.previews.close();
      } catch (error) {
        failures.push(errorFrom(error));
      } finally {
        transport.disconnect(failures[0]);
      }
      if (activeProject === transport) activeProject = null;
      if (failures.length === 1) throw failures[0] as Error;
      if (failures.length > 1) {
        throw new AggregateError(failures, 'Workbench project owner and preview close failed');
      }
    };

    if (companion !== undefined) {
      const runtime = companion.runtime;
      let session: ProjectSession<unknown>;
      if (runtime.kind === 'node-cli') {
        if (definition.kind !== 'node-cli') {
          throw new TypeError('Owner Playground runtime does not match the project definition');
        }
        session = createProjectSession<void>({
          content,
          runtime: createNodeCliProjectRuntime({
            terminal,
            entryPath: definition.entryPath,
            args: definition.args,
            acquisition: companion.acquisition,
          }),
          terminal,
          createTerminal: openTerminal,
          closeOwner,
        });
      } else {
        if (runtime.kind === 'node-server') {
          if (definition.kind !== 'node-server') {
            throw new TypeError('Owner Playground runtime does not match the project definition');
          }
          session = createProjectSession<PreviewHandle>({
            content,
            runtime: createNodeServerProjectRuntime({
              terminal,
              ownerToken: transport.token,
              entryPath: definition.entryPath,
              port: definition.port,
              createPreviewReadiness: previewReadiness,
              acquisition: companion.acquisition,
            }),
            terminal,
            createTerminal: openTerminal,
            closeOwner,
          });
        } else {
          if (definition.kind !== 'vite') {
            throw new TypeError('Owner Playground runtime does not match the project definition');
          }
          session = createProjectSession<PreviewHandle>({
            content,
            runtime: createViteProjectRuntime({
              terminal,
              ownerToken: transport.token,
              port: runtime.port,
              createPreviewReadiness: previewReadiness,
              acquisition: companion.acquisition,
            }),
            terminal,
            createTerminal: openTerminal,
            closeOwner,
          });
        }
      }
      // The owner-born finite runtime decision is the authority for readiness.
      return session as ProjectSession<TReady>;
    }

    const session =
      definition.kind === 'node-cli'
        ? createProjectSession<void>({
            content,
            runtime: createNodeCliProjectRuntime({
              terminal,
              entryPath: definition.entryPath,
              args: definition.args,
            }),
            terminal,
            createTerminal: openTerminal,
            closeOwner,
          })
        : createProjectSession<PreviewHandle>({
            content,
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
            closeOwner,
          });
    // ProjectDefinition<TReady> is package-branded; the exhaustive finite kind
    // dispatch above is the sole place that maps its phantom readiness type.
    return session as ProjectSession<TReady>;
  };

  const admitOpenedProject = async <TReady>(
    opened: OpenedProject,
    definition: InspectedProjectDefinition<TReady>,
    companion?: OpenedPlaygroundProject,
  ): Promise<ProjectSession<TReady>> => {
    const transport = makeProjectTransport(opened, companion?.initialScmSnapshot ?? null);
    activeProject = transport;
    try {
      const content = await transport.content.ready;
      const session = createBrowserProject<TReady>(transport, definition, content, companion);
      if (companion !== undefined) {
        playgroundSessions.set(session, { transport, content, lifecycle: null });
      }
      return session;
    } catch (error) {
      const failures = [errorFrom(error)];
      try {
        await requestCloseProject(opened.projectToken);
      } catch (closeError) {
        failures.push(errorFrom(closeError));
      }
      try {
        await transport.previews.close();
      } catch (previewError) {
        failures.push(errorFrom(previewError));
      }
      transport.disconnect();
      if (activeProject === transport) activeProject = null;
      if (failures.length === 1) throw failures[0] as Error;
      throw new AggregateError(failures, 'Workbench project construction and cleanup failed');
    }
  };

  const inspectCompanionDefinition = <TReady>(
    definition: ProjectDefinition<TReady>,
  ): InspectedPlaygroundProjectDefinition<TReady> => {
    if (playgroundUrlContext === undefined) {
      throw new TypeError('Playground companion owner is unavailable');
    }
    return inspectPlaygroundProjectDefinition(definition, playgroundUrlContext);
  };

  const requestCatalog = (
    command: PlaygroundCatalogCommand,
  ): Promise<PlaygroundCatalogSnapshot> => {
    currentCatalog();
    const opId = dependencies.operationId();
    const operation = {
      ...deferred<PlaygroundCatalogSnapshot>(),
      kind: 'playground-catalog' as const,
    };
    return request<PlaygroundCatalogSnapshot>(operation, {
      type: 'workbench:playground-catalog',
      opId,
      command,
    });
  };

  const catalog: PlaygroundProjectCatalog | undefined = companionMode
    ? Object.freeze({
        snapshot: currentCatalog,
        subscribe(listener: (snapshot: PlaygroundCatalogSnapshot) => void) {
          if (typeof listener !== 'function') {
            throw new TypeError('Catalog listener must be a function');
          }
          const snapshot = currentCatalog();
          catalogListeners.add(listener);
          listener(snapshot);
          return () => catalogListeners.delete(listener);
        },
        createScratch(input: Parameters<PlaygroundProjectCatalog['createScratch']>[0]) {
          inspectCompanionDefinition(input.definition);
          return requestCatalog({
            kind: 'create-scratch',
            definition: playgroundProjectDefinitionWire(input.definition),
            ...(input.preserveDirtySameStarter === undefined
              ? {}
              : { preserveDirtySameStarter: input.preserveDirtySameStarter }),
          });
        },
        saveScratch(input: Parameters<PlaygroundProjectCatalog['saveScratch']>[0]) {
          inspectCompanionDefinition(input.definition);
          return requestCatalog({
            kind: 'save-scratch',
            id: input.id,
            name: input.name,
            definition: playgroundProjectDefinitionWire(input.definition),
          });
        },
        activate(target: Parameters<PlaygroundProjectCatalog['activate']>[0]) {
          return requestCatalog({ kind: 'activate', target });
        },
        rename(...args: Parameters<PlaygroundProjectCatalog['rename']>) {
          return requestCatalog({ kind: 'rename', id: args[0], name: args[1] });
        },
        reset(input: Parameters<PlaygroundProjectCatalog['reset']>[0]) {
          inspectCompanionDefinition(input.definition);
          return requestCatalog({
            kind: 'reset',
            target: input.target,
            definition: playgroundProjectDefinitionWire(input.definition),
          });
        },
        delete(id: string) {
          return requestCatalog({ kind: 'delete', id });
        },
      } satisfies PlaygroundProjectCatalog)
    : undefined;

  const playgroundHandle: RawWorkspaceOwnerHandle['playground'] =
    catalog === undefined
      ? undefined
      : Object.freeze({
          catalog,
          async openProject<TReady>(
            definition: ProjectDefinition<TReady>,
            projectOptions?: PlaygroundProjectOpenOptions,
          ) {
            const ownedOptions = ownPlaygroundProjectOpenOptions(projectOptions);
            if (activeProject !== null) throw new ProjectBusyError('Workbench owner project');
            const inspected = inspectCompanionDefinition(definition);
            const opId = dependencies.operationId();
            const operation = {
              ...deferred<OpenedPlaygroundProject>(),
              kind: 'playground-open' as const,
            };
            const opened = await request<OpenedPlaygroundProject>(operation, {
              type: 'workbench:playground-open-project',
              opId,
              definition: playgroundProjectDefinitionWire(definition),
              ...(ownedOptions.initialTerminalState === undefined
                ? {}
                : { initialTerminalState: ownedOptions.initialTerminalState }),
            });
            return admitOpenedProject(opened, inspected, opened);
          },
          sessionTools(session: ProjectSession<unknown>) {
            const state =
              typeof session === 'object' && session !== null
                ? playgroundSessions.get(session)
                : undefined;
            if (state === undefined) {
              throw new TypeError('Invalid, forged, or foreign Playground ProjectSession');
            }
            if (activeProject !== state.transport) {
              throw new ClosedHandleError('Playground ProjectSession');
            }
            if (state.lifecycle === null) {
              const core: BrowserPlaygroundSessionToolsLifecycle =
                createBrowserPlaygroundSessionTools({
                  projectRoot: state.transport.projectRoot,
                  documents: state.content,
                  initialScmSnapshot: state.transport.playgroundScmSnapshot(),
                  initialOperationalHealth: state.transport.playgroundOperationalHealth(),
                  previews: state.transport.previews.registry,
                  send(frame) {
                    if (activeProject !== state.transport) return false;
                    send({
                      type: 'workbench:playground-project-tools',
                      projectToken: state.transport.token,
                      frame,
                    });
                    return true;
                  },
                  subscribe: (listener) => state.transport.subscribePlaygroundTools(listener),
                  generateRequestId: dependencies.operationId,
                });
              state.lifecycle = Object.freeze({
                tools: core.tools,
                subscribeOperationalHealth: (
                  listener: (health: PlaygroundOwnerOperationalHealth) => void,
                ) => state.transport.subscribeOperationalHealth(listener),
                async recoverOperationalHealth(
                  scope: PlaygroundOwnerOperationalHealth['scope'],
                ): Promise<void> {
                  if (scope === 'scm') {
                    await core.tools.scm.refresh();
                    return;
                  }
                  await state.transport.previews.recover();
                },
                close: () => core.close(),
              });
            }
            return state.lifecycle;
          },
        });

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
      return admitOpenedProject(opened, definition);
    },
    deleteProject(id: string) {
      if (activeProject !== null) {
        return Promise.reject(new ProjectBusyError('Workbench owner project'));
      }
      const opId = dependencies.operationId();
      const operation = { ...deferred<void>(), kind: 'delete' as const, id };
      return request<void>(operation, { type: 'workbench:delete-project', opId, id });
    },
    ...(playgroundHandle === undefined ? {} : { playground: playgroundHandle }),
    subscribeHealth(listener) {
      if (typeof listener !== 'function') {
        throw new TypeError('Workbench owner health listener must be a function');
      }
      healthListeners.add(listener);
      if (invariantHealth !== null) {
        try {
          listener(invariantHealth);
        } catch {
          // Replay follows the same listener isolation as live delivery.
        }
      }
      return () => healthListeners.delete(listener);
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
