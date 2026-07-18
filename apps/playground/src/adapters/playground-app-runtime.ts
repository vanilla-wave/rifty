import type {
  PlaygroundCatalogSnapshot,
  PlaygroundProjectPlan,
  PlaygroundProjectRef,
  PlaygroundSessionToolsView,
  PlaygroundWorkbench,
} from '../workbench/playground.ts';
import {
  ClosedHandleError,
  DirtyProjectDocumentError,
  type ProjectDefinition,
  ProjectDocumentSaveInProgressError,
  type ProjectSession,
  type ProjectTerminalSnapshot,
} from '../workbench/public.ts';

export interface PlaygroundAppProjectContext {
  readonly plan: PlaygroundProjectPlan;
  readonly definition: ProjectDefinition<unknown>;
  readonly session: ProjectSession<unknown>;
  readonly tools: PlaygroundSessionToolsView;
}

export interface PlaygroundAppRuntime {
  readonly workbench: PlaygroundWorkbench;
  readonly catalog: PlaygroundWorkbench['playground']['catalog'];
  current(): PlaygroundAppProjectContext | null;
  openActive(plan: PlaygroundProjectPlan): Promise<PlaygroundAppProjectContext>;
  createScratch(
    plan: PlaygroundProjectPlan,
    options?: { readonly preserveDirtySameStarter?: boolean },
  ): Promise<PlaygroundAppProjectContext>;
  saveScratch(plan: PlaygroundProjectPlan, name: string): Promise<PlaygroundAppProjectContext>;
  activate(plan: PlaygroundProjectPlan): Promise<PlaygroundAppProjectContext>;
  reset(plan: PlaygroundProjectPlan): Promise<PlaygroundAppProjectContext | null>;
  rename(id: string, name: string): Promise<PlaygroundAppProjectContext | null>;
  delete(id: string): Promise<PlaygroundAppProjectContext | null>;
  closeCurrent(): Promise<void>;
  close(): Promise<void>;
}

export interface PlaygroundAppRuntimeOptions {
  /** Host persistence policy; sampled for each new owner-bound project session. */
  readonly terminalState?: () => ProjectTerminalSnapshot;
}

function planRef(plan: PlaygroundProjectPlan): PlaygroundProjectRef {
  return plan.id === 'scratch'
    ? Object.freeze({ kind: 'scratch' as const })
    : Object.freeze({ kind: 'project' as const, id: plan.id });
}

function activeMatches(snapshot: PlaygroundCatalogSnapshot, plan: PlaygroundProjectPlan): boolean {
  const active = snapshot.active;
  return plan.id === 'scratch'
    ? active?.kind === 'scratch'
    : active?.kind === 'project' && active.id === plan.id;
}

function isRetryableClosePreflightError(
  error: unknown,
): error is DirtyProjectDocumentError | ProjectDocumentSaveInProgressError {
  return (
    error instanceof DirtyProjectDocumentError ||
    error instanceof ProjectDocumentSaveInProgressError
  );
}

/**
 * Page policy over the semantic companion. The owner remains the catalog/tree
 * authority; this adapter only serializes UI intents and enforces one live
 * public ProjectSession before asking that authority to mutate its catalog.
 */
export function createPlaygroundAppRuntime(
  workbench: PlaygroundWorkbench,
  options: PlaygroundAppRuntimeOptions = {},
): PlaygroundAppRuntime {
  const catalog = workbench.playground.catalog;
  let active: PlaygroundAppProjectContext | null = null;
  let operationTail: Promise<void> = Promise.resolve();
  let closing = false;
  let closed = false;
  let closePromise: Promise<void> | null = null;

  const assertOpen = (): void => {
    if (closing || closed) throw new ClosedHandleError('Playground App runtime');
  };

  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    try {
      assertOpen();
    } catch (error) {
      return Promise.reject(error);
    }
    const result = operationTail.then(async () => {
      assertOpen();
      return operation();
    });
    operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const openDefinition = async (
    plan: PlaygroundProjectPlan,
    definition: ProjectDefinition<unknown>,
  ): Promise<PlaygroundAppProjectContext> => {
    const initialTerminalState = options.terminalState?.();
    const session = await workbench.openProject(
      definition,
      initialTerminalState === undefined ? {} : { initialTerminalState },
    );
    try {
      const context = Object.freeze({
        plan,
        definition,
        session,
        tools: workbench.playground.forSession(session),
      });
      active = context;
      return context;
    } catch (error) {
      try {
        await session.close();
      } catch (closeError) {
        throw new AggregateError(
          [error, closeError],
          'Playground session tools binding and cleanup failed',
        );
      }
      throw error;
    }
  };

  const closeActive = async (): Promise<PlaygroundAppProjectContext | null> => {
    const prior = active;
    if (prior === null) return null;
    try {
      await prior.session.close();
    } catch (error) {
      if (!isRetryableClosePreflightError(error) && active === prior) active = null;
      throw error;
    }
    if (active === prior) active = null;
    return prior;
  };

  const restoreAfterMutationFailure = async (
    prior: PlaygroundAppProjectContext | null,
    failure: unknown,
  ): Promise<never> => {
    if (prior === null || !activeMatches(catalog.snapshot(), prior.plan)) throw failure;
    try {
      await openDefinition(prior.plan, prior.definition);
    } catch (restoreFailure) {
      throw new AggregateError(
        [failure, restoreFailure],
        'Playground catalog mutation failed and the prior session could not be restored',
      );
    }
    throw failure;
  };

  const defineTransition = (
    plan: PlaygroundProjectPlan,
    mutate: (definition: ProjectDefinition<unknown>) => Promise<PlaygroundCatalogSnapshot>,
  ): Promise<PlaygroundAppProjectContext> =>
    enqueue(async () => {
      const definition = workbench.playground.define(plan);
      const prior = await closeActive();
      try {
        await mutate(definition);
      } catch (error) {
        return restoreAfterMutationFailure(prior, error);
      }
      return openDefinition(plan, definition);
    });

  const mutateAndRestore = (
    mutate: () => Promise<PlaygroundCatalogSnapshot>,
  ): Promise<PlaygroundAppProjectContext | null> =>
    enqueue(async () => {
      const prior = await closeActive();
      try {
        await mutate();
      } catch (error) {
        return restoreAfterMutationFailure(prior, error);
      }
      if (prior === null || !activeMatches(catalog.snapshot(), prior.plan)) return null;
      return openDefinition(prior.plan, prior.definition);
    });

  const runtime: PlaygroundAppRuntime = {
    workbench,
    catalog,

    current: () => active,

    openActive(plan) {
      return enqueue(async () => {
        if (!activeMatches(catalog.snapshot(), plan)) {
          throw new TypeError(`Playground plan ${JSON.stringify(plan.id)} is not active`);
        }
        if (active?.plan.id === plan.id && active.plan.starterId === plan.starterId) return active;
        await closeActive();
        return openDefinition(plan, workbench.playground.define(plan));
      });
    },

    createScratch(plan, options = {}) {
      if (plan.id !== 'scratch') {
        return Promise.reject(new TypeError('Scratch plan id must be "scratch"'));
      }
      return defineTransition(plan, (definition) =>
        catalog.createScratch({
          definition,
          ...(options.preserveDirtySameStarter === undefined
            ? {}
            : { preserveDirtySameStarter: options.preserveDirtySameStarter }),
        }),
      );
    },

    saveScratch(plan, name) {
      if (plan.id === 'scratch') {
        return Promise.reject(new TypeError('Named project id cannot be "scratch"'));
      }
      return defineTransition(plan, (definition) =>
        catalog.saveScratch({ id: plan.id, name, definition }),
      );
    },

    activate(plan) {
      return defineTransition(plan, () => catalog.activate(planRef(plan)));
    },

    reset(plan) {
      return enqueue(async () => {
        const definition = workbench.playground.define(plan);
        const prior = await closeActive();
        let next: PlaygroundCatalogSnapshot;
        try {
          next = await catalog.reset({ target: planRef(plan), definition });
        } catch (error) {
          return restoreAfterMutationFailure(prior, error);
        }
        if (activeMatches(next, plan)) return openDefinition(plan, definition);
        if (prior !== null && activeMatches(next, prior.plan)) {
          return openDefinition(prior.plan, prior.definition);
        }
        return null;
      });
    },

    rename: (id, name) =>
      enqueue(async () => {
        await catalog.rename(id, name);
        return active;
      }),

    delete: (id) => mutateAndRestore(() => catalog.delete(id)),

    closeCurrent: () => enqueue(async () => void (await closeActive())),

    close() {
      if (closePromise !== null) return closePromise;
      if (closed) return Promise.resolve();
      closing = true;
      const attempt = operationTail.then(async () => {
        await closeActive();
        await workbench.close();
        closed = true;
      });
      closePromise = attempt.catch((error: unknown) => {
        closing = false;
        closePromise = null;
        throw error;
      });
      return closePromise;
    },
  };

  return Object.freeze(runtime);
}
