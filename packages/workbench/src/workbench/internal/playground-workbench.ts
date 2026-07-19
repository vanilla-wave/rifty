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
  PlaygroundSessionTools,
  PlaygroundTerminalStateRestoreInput,
  PlaygroundWorkbench,
  PlaygroundWorkbenchOptions,
  VitePlaygroundPlan,
} from '../playground.ts';
import type { PreviewHandle } from '../preview-readiness.ts';
import type { ProjectDefinition } from '../project-definition.ts';
import type { ProjectSession } from '../project-session.ts';
import {
  type CapturedPlaygroundUrlContext,
  ownPlaygroundProjectPlan,
} from './playground-project-definition.ts';
import {
  ownPlaygroundProjectOpenOptions,
  restorePlaygroundTerminalState,
} from './playground-terminal-state.ts';

interface SessionToolLifecycle {
  readonly tools: PlaygroundSessionTools;
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
  readonly createSessionTools: (session: ProjectSession<unknown>) => SessionToolLifecycle;
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

export function createPlaygroundWorkbenchFacade(
  options: CreatePlaygroundWorkbenchFacadeOptions,
): PlaygroundWorkbench {
  const workbenchInternals = inspectWorkbenchInternals(options.workbench);
  const ownedDefinitions = new WeakMap<object, PlaygroundProjectPlan>();
  const ownedSessions = new WeakMap<object, OwnedSession>();
  const sessionStates = new Set<OwnedSession>();
  let closed = false;
  let closePromise: Promise<void> | null = null;

  const catalog = Object.freeze({
    snapshot: () => options.catalog.snapshot(),
    subscribe: (listener) => options.catalog.subscribe(listener),
    createScratch: (input) => options.catalog.createScratch(input),
    saveScratch: (input) => options.catalog.saveScratch(input),
    activate: (target) => options.catalog.activate(target),
    rename: (id, name) => options.catalog.rename(id, name),
    reset: (input) => options.catalog.reset(input),
    delete: (id: string) => {
      assertOpen();
      return workbenchInternals
        .deleteProjectWithOwner(id, async () => {
          await options.catalog.delete(id);
        })
        .then(() => options.catalog.snapshot());
    },
  } satisfies PlaygroundProjectCatalog);

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

  const wrapSession = <TReady>(raw: ProjectSession<TReady>): ProjectSession<TReady> => {
    const state: OwnedSession = {
      ownerSession: workbenchInternals.rawSession(raw),
      state: 'live',
      lifecycle: null,
      toolCloseFailure: null,
      closePromise: null,
    };
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
    options.registerBeforeClose(raw, async () => {
      if (state.lifecycle === null) return;
      try {
        await state.lifecycle.close();
      } catch (error) {
        state.toolCloseFailure = error;
      }
    });
    return wrapped;
  };

  const facade: PlaygroundWorkbench = Object.freeze({
    runtimeAssets: options.workbench.runtimeAssets,
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
      if (!activeMatches(catalog, plan.id)) {
        throw new TypeError(`Playground project ${JSON.stringify(plan.id)} is not active`);
      }
      const opened =
        options.openProject === undefined
          ? await options.workbench.openProject(definition, ownedOptions)
          : await options.openProject(definition, ownedOptions);
      return wrapSession(opened);
    },
    async deleteProject(id: string): Promise<void> {
      assertOpen();
      await catalog.delete(id);
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
      catalog,
      restoreTerminalState: (input: PlaygroundTerminalStateRestoreInput) =>
        restorePlaygroundTerminalState(input, options.legacyWorkspacePrefix),
      forSession<T>(session: ProjectSession<T>): PlaygroundSessionTools {
        assertOpen();
        const state =
          typeof session === 'object' && session !== null ? ownedSessions.get(session) : undefined;
        if (state === undefined) throw new TypeError('Foreign or forged Playground ProjectSession');
        if (state.state !== 'live') throw new ClosedHandleError('Playground ProjectSession');
        if (state.lifecycle === null) {
          state.lifecycle = options.createSessionTools(state.ownerSession);
        }
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
