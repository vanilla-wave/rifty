import { ClosedHandleError, isRetryableProjectClosePreflightError } from '../errors.ts';
import {
  type Workbench,
  type WorkbenchOptions,
  type WorkbenchSnapshot,
  inspectWorkbenchInternals,
} from '../open-workbench.ts';
import type {
  NodeCliPlaygroundPlan,
  NodeServerPlaygroundPlan,
  PlaygroundProjectCatalog,
  PlaygroundProjectOpenOptions,
  PlaygroundProjectPlan,
  PlaygroundSessionToolsView,
  PlaygroundTerminalStateRestoreInput,
  PlaygroundWorkbench,
  PlaygroundWorkbenchOptions,
  VitePlaygroundPlan,
} from '../playground.ts';
import type { PreviewHandle } from '../preview-readiness.ts';
import type { ProjectDefinition } from '../project-definition.ts';
import type { ProjectSession } from '../project-session.ts';
import type {
  PlaygroundOwnerOperationalHealth,
  PlaygroundOwnerSessionToolLifecycle,
} from '../workbench-owner-port.ts';
import {
  type CapturedPlaygroundUrlContext,
  ownPlaygroundProjectPlan,
} from './playground-project-definition.ts';
import { isPlaygroundPersistenceFailure } from './playground-session-tools-transport.ts';
import {
  ownPlaygroundProjectOpenOptions,
  restorePlaygroundTerminalState,
} from './playground-terminal-state.ts';
import type { WorkbenchHealthGeneration } from './workbench-health-authority.ts';

type RawSessionToolLifecycle = PlaygroundOwnerSessionToolLifecycle;

interface SessionToolLifecycle {
  readonly tools: PlaygroundSessionToolsView;
  close(): Promise<void>;
}

export interface CreatePlaygroundWorkbenchFacadeOptions {
  readonly workbench: Workbench;
  readonly urlContext: CapturedPlaygroundUrlContext;
  readonly legacyWorkspacePrefix?: string;
  readonly definePlan: (plan: PlaygroundProjectPlan) => ProjectDefinition<unknown>;
  readonly catalog: PlaygroundProjectCatalog;
  readonly openProject?: <TReady>(
    definition: ProjectDefinition<TReady>,
    options: PlaygroundProjectOpenOptions,
  ) => Promise<ProjectSession<TReady>>;
  readonly createSessionTools: (session: ProjectSession<unknown>) => RawSessionToolLifecycle;
  readonly registerBeforeClose: (
    session: ProjectSession<unknown>,
    hook: () => Promise<void>,
  ) => void;
}

export interface CreateOpenPlaygroundWorkbenchDependencies {
  readonly captureUrlContext: () => CapturedPlaygroundUrlContext;
  readonly openWorkbench: (
    options: WorkbenchOptions,
    urlContext: CapturedPlaygroundUrlContext,
  ) => Promise<Workbench>;
  readonly createFacade: (input: {
    readonly workbench: Workbench;
    readonly urlContext: CapturedPlaygroundUrlContext;
  }) => PlaygroundWorkbench;
}

type OwnedSessionState = 'live' | 'closing' | 'closed';

interface OwnedSession {
  readonly ownerSession: ProjectSession<unknown>;
  readonly healthGeneration: WorkbenchHealthGeneration;
  state: OwnedSessionState;
  lifecycle: SessionToolLifecycle | null;
  toolCloseFailure: unknown | null;
  closePromise: Promise<void> | null;
}

function closeFailure(toolFailure: unknown | null, coreFailure: unknown | null): never {
  const failures = [toolFailure, coreFailure].filter((error) => error !== null);
  if (failures.length === 1) throw failures[0];
  throw new AggregateError(failures, 'Playground session tool and core teardown failed');
}

function activeMatches(catalog: PlaygroundProjectCatalog, id: string): boolean {
  const active = catalog.snapshot().active;
  if (active?.kind === 'scratch') return id === 'scratch';
  return active?.kind === 'project' && active.id === id;
}

function operationalHealthSummary(scope: PlaygroundOwnerOperationalHealth['scope']): string {
  return scope === 'scm' ? 'Source control refresh failed' : 'Preview routing failed';
}

export function createPlaygroundWorkbenchFacade(
  options: CreatePlaygroundWorkbenchFacadeOptions,
): PlaygroundWorkbench {
  const workbenchInternals = inspectWorkbenchInternals(options.workbench);
  const ownedDefinitions = new WeakMap<object, PlaygroundProjectPlan>();
  const ownedSessions = new WeakMap<object, OwnedSession>();
  const sessionStates = new Set<OwnedSession>();
  let closed = false;
  let closePromise: Promise<void> | null = null;

  const assertOpen = (): void => {
    if (closed) throw new ClosedHandleError('Playground Workbench');
  };

  function define(plan: VitePlaygroundPlan): ProjectDefinition<PreviewHandle>;
  function define(plan: NodeServerPlaygroundPlan): ProjectDefinition<PreviewHandle>;
  function define(plan: NodeCliPlaygroundPlan): ProjectDefinition<void>;
  function define(plan: PlaygroundProjectPlan): ProjectDefinition<unknown>;
  function define(plan: PlaygroundProjectPlan): ProjectDefinition<unknown> {
    assertOpen();
    const owned = ownPlaygroundProjectPlan(plan, options.urlContext);
    const definition = options.definePlan(owned);
    if (typeof definition !== 'object' || definition === null) {
      throw new TypeError('Playground definition factory returned an invalid handle');
    }
    ownedDefinitions.set(definition, owned);
    return definition;
  }

  const connectSessionTools = async (state: OwnedSession): Promise<SessionToolLifecycle> => {
    const raw = options.createSessionTools(state.ownerSession);
    let unsubscribeHealth: () => void;
    try {
      unsubscribeHealth = raw.subscribeOperationalHealth((health) => {
        if (health.status === 'healthy') {
          state.healthGeneration.reporter.clear(health.scope);
          return;
        }
        state.healthGeneration.reporter.degraded({
          scope: health.scope,
          summary: operationalHealthSummary(health.scope),
          recover: () => raw.recoverOperationalHealth(health.scope),
        });
      });
    } catch (error) {
      try {
        await raw.close();
      } catch (closeError) {
        throw new AggregateError(
          [error, closeError],
          'Playground session health subscription and tool cleanup failed',
        );
      }
      throw error;
    }
    let lifecycleClose: Promise<void> | null = null;
    return Object.freeze({
      tools: Object.freeze({
        typescript: raw.tools.typescript,
        scm: raw.tools.scm,
        archive: raw.tools.archive,
        previews: raw.tools.previews,
        health: state.healthGeneration.health,
        async awaitDurability(): Promise<void> {
          try {
            await raw.tools.awaitDurability();
            state.healthGeneration.reporter.clear('persistence');
          } catch (error) {
            if (isPlaygroundPersistenceFailure(error)) {
              state.healthGeneration.reporter.degraded({
                scope: 'persistence',
                summary: 'Workspace persistence failed',
                recover: () => raw.tools.awaitDurability(),
              });
            }
            throw error;
          }
        },
      }),
      close(): Promise<void> {
        if (lifecycleClose !== null) return lifecycleClose;
        unsubscribeHealth();
        try {
          lifecycleClose = raw.close();
        } catch (error) {
          lifecycleClose = Promise.reject(error);
        }
        void lifecycleClose.catch(() => {});
        return lifecycleClose;
      },
    });
  };

  const wrapSession = async <TReady>(
    raw: ProjectSession<TReady>,
  ): Promise<ProjectSession<TReady>> => {
    const healthGeneration = workbenchInternals.healthGeneration(raw);
    const state: OwnedSession = {
      ownerSession: workbenchInternals.rawSession(raw),
      healthGeneration,
      state: 'live',
      lifecycle: null,
      toolCloseFailure: null,
      closePromise: null,
    };
    try {
      state.lifecycle = await connectSessionTools(state);
      options.registerBeforeClose(raw, async () => {
        if (state.lifecycle === null) return;
        try {
          await state.lifecycle.close();
        } catch (error) {
          state.toolCloseFailure = error;
        }
      });
    } catch (error) {
      const failures: unknown[] = [error];
      if (state.lifecycle !== null) {
        try {
          await state.lifecycle.close();
        } catch (closeError) {
          failures.push(closeError);
        }
      }
      try {
        await raw.close();
      } catch (closeError) {
        failures.push(closeError);
      }
      if (failures.length === 1) throw failures[0];
      throw new AggregateError(failures, 'Playground session facade creation and cleanup failed');
    }
    sessionStates.add(state);

    const wrapped = Object.freeze({
      files: raw.files,
      documents: raw.documents,
      run: () => raw.run(),
      terminals: raw.terminals,
      close(): Promise<void> {
        if (state.closePromise !== null) return state.closePromise;
        if (state.state === 'closed') return Promise.resolve();
        state.state = 'closing';
        let coreClose: Promise<void>;
        try {
          coreClose = raw.close();
        } catch (error) {
          coreClose = Promise.reject(error);
        }
        const closing = coreClose.then(
          () => {
            state.state = 'closed';
            sessionStates.delete(state);
            if (state.toolCloseFailure !== null) closeFailure(state.toolCloseFailure, null);
          },
          (error: unknown) => {
            if (isRetryableProjectClosePreflightError(error) && state.toolCloseFailure === null) {
              state.state = 'live';
              state.closePromise = null;
              throw error;
            }
            state.state = 'closed';
            sessionStates.delete(state);
            closeFailure(state.toolCloseFailure, error);
          },
        );
        state.closePromise = closing;
        void closing.catch(() => {});
        return closing;
      },
    }) satisfies ProjectSession<TReady>;
    ownedSessions.set(wrapped, state);
    return wrapped;
  };

  const facade: PlaygroundWorkbench = Object.freeze({
    health: options.workbench.health,
    snapshot(): WorkbenchSnapshot {
      return options.workbench.snapshot();
    },
    async openProject<TReady>(
      definition: ProjectDefinition<TReady>,
      projectOptions?: PlaygroundProjectOpenOptions,
    ): Promise<ProjectSession<TReady>> {
      assertOpen();
      const ownedOptions = ownPlaygroundProjectOpenOptions(projectOptions);
      const plan =
        typeof definition === 'object' && definition !== null
          ? ownedDefinitions.get(definition)
          : undefined;
      if (plan === undefined) throw new TypeError('Foreign or forged Playground ProjectDefinition');
      if (!activeMatches(options.catalog, plan.id)) {
        throw new TypeError(`Playground project ${JSON.stringify(plan.id)} is not active`);
      }
      const opened =
        options.openProject === undefined
          ? await options.workbench.openProject(definition)
          : await options.openProject(definition, ownedOptions);
      return wrapSession(opened);
    },
    async deleteProject(id: string): Promise<void> {
      assertOpen();
      await options.catalog.delete(id);
    },
    close(): Promise<void> {
      if (closePromise !== null) return closePromise;
      if (closed) return Promise.resolve();
      closed = true;
      let coreClose: Promise<void>;
      try {
        coreClose = options.workbench.close();
      } catch (error) {
        coreClose = Promise.reject(error);
      }
      const closing = coreClose.then(
        () => {
          for (const state of sessionStates) state.state = 'closed';
          sessionStates.clear();
        },
        (error: unknown) => {
          if (isRetryableProjectClosePreflightError(error)) {
            closed = false;
            closePromise = null;
            throw error;
          }
          for (const state of sessionStates) state.state = 'closed';
          sessionStates.clear();
          throw error;
        },
      );
      closePromise = closing;
      void closing.catch(() => {});
      return closing;
    },
    playground: Object.freeze({
      define,
      catalog: options.catalog,
      restoreTerminalState: (input: PlaygroundTerminalStateRestoreInput) =>
        restorePlaygroundTerminalState(input, options.legacyWorkspacePrefix),
      forSession<T>(session: ProjectSession<T>): PlaygroundSessionToolsView {
        assertOpen();
        const state =
          typeof session === 'object' && session !== null ? ownedSessions.get(session) : undefined;
        if (state === undefined) throw new TypeError('Foreign or forged Playground ProjectSession');
        if (state.state !== 'live') throw new ClosedHandleError('Playground ProjectSession');
        if (state.lifecycle === null) throw new Error('Playground session tools are unavailable');
        return state.lifecycle.tools;
      },
    }),
  });
  return facade;
}

export function createOpenPlaygroundWorkbench(
  dependencies: CreateOpenPlaygroundWorkbenchDependencies,
): (options: PlaygroundWorkbenchOptions) => Promise<PlaygroundWorkbench> {
  return async (options: PlaygroundWorkbenchOptions): Promise<PlaygroundWorkbench> => {
    if (
      typeof options?.deployment?.workers?.typescript !== 'string' ||
      options.deployment.workers.typescript.length === 0
    ) {
      throw new TypeError('deployment.workers.typescript must be a non-empty string');
    }
    const captured = dependencies.captureUrlContext();
    const urlContext = Object.freeze({
      apiBaseUrl: captured.apiBaseUrl,
      clientUrl: captured.clientUrl,
    });
    const workbench = await dependencies.openWorkbench(options, urlContext);
    try {
      return dependencies.createFacade({ workbench, urlContext });
    } catch (error) {
      try {
        await workbench.close();
      } catch (closeError) {
        throw new AggregateError(
          [error, closeError],
          'Playground Workbench facade creation and cleanup failed',
        );
      }
      throw error;
    }
  };
}
