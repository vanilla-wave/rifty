import {
  DirtyProjectDocumentError,
  type ProjectDefinition,
  ProjectDefinitionMismatchError,
  ProjectDocumentSaveInProgressError,
  type ProjectSession,
  type ProjectTerminalSnapshot,
  type WorkbenchHealth,
  type WorkbenchHealthSnapshot,
} from '@riftydev/workbench';
import type {
  PlaygroundCatalogSnapshot,
  PlaygroundProjectPlan,
  PlaygroundSessionToolsView,
  PlaygroundWorkbench,
} from '@riftydev/workbench/playground';
import { describe, expect, it, vi } from 'vitest';
import { createPlaygroundAppRuntime } from './playground-app-runtime.ts';

const EMPTY_CATALOG: PlaygroundCatalogSnapshot = Object.freeze({
  active: null,
  scratch: null,
  projects: Object.freeze([]),
});

function plan(id: string, starterId = 'starter-a'): PlaygroundProjectPlan {
  return Object.freeze({
    kind: 'node-cli',
    id,
    starterId,
    templateId: 'cli-v1',
    files: Object.freeze({ '/cli.mjs': 'console.log("ok")\n' }),
    firstMaterialization: Object.freeze({ kind: 'install' }),
    entryPath: '/cli.mjs',
  });
}

const HEALTHY = Object.freeze({
  disposition: 'healthy',
  issues: Object.freeze([]),
}) satisfies WorkbenchHealthSnapshot;

function health(): WorkbenchHealth {
  return Object.freeze({
    snapshot: () => HEALTHY,
    subscribe(listener: (snapshot: WorkbenchHealthSnapshot) => void) {
      listener(HEALTHY);
      return () => {};
    },
    recover: (scope: Parameters<WorkbenchHealth['recover']>[0]) =>
      Promise.reject(new Error(`Workbench recovery scope ${scope} is not active`)),
  });
}

function tools(): PlaygroundSessionToolsView {
  return Object.freeze({
    typescript: {} as PlaygroundSessionToolsView['typescript'],
    scm: {} as PlaygroundSessionToolsView['scm'],
    archive: {} as PlaygroundSessionToolsView['archive'],
    previews: {} as PlaygroundSessionToolsView['previews'],
    health: health(),
    awaitDurability: async () => {},
  });
}

interface Harness {
  runtime: ReturnType<typeof createPlaygroundAppRuntime>;
  workbench: PlaygroundWorkbench;
  readonly events: string[];
  readonly openOptions: unknown[];
  catalog: PlaygroundCatalogSnapshot;
  failNextMutation: Error | null;
  failNextClose: Error | null;
  failMutation(operation: string, failure: Error): void;
  failOpen(id: string, failure: Error): void;
  deferOpenFailure(
    id: string,
    failure: Error,
  ): { readonly entered: Promise<void>; release(): void };
}

function harness(terminalState?: () => ProjectTerminalSnapshot): Harness {
  const events: string[] = [];
  const openOptions: unknown[] = [];
  const definitions = new WeakMap<object, PlaygroundProjectPlan>();
  const listeners = new Set<(snapshot: PlaygroundCatalogSnapshot) => void>();
  const mutationFailures = new Map<string, Error[]>();
  const openFailures = new Map<
    string,
    {
      readonly failure: Error;
      readonly gate: Promise<void> | null;
      readonly markEntered: (() => void) | null;
    }[]
  >();
  const state: Harness = {
    runtime: undefined as never,
    workbench: undefined as never,
    events,
    openOptions,
    catalog: EMPTY_CATALOG,
    failNextMutation: null,
    failNextClose: null,
    failMutation(operation, failure) {
      const failures = mutationFailures.get(operation) ?? [];
      failures.push(failure);
      mutationFailures.set(operation, failures);
    },
    failOpen(id, failure) {
      const failures = openFailures.get(id) ?? [];
      failures.push({ failure, gate: null, markEntered: null });
      openFailures.set(id, failures);
    },
    deferOpenFailure(id, failure) {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let markEntered!: () => void;
      const entered = new Promise<void>((resolve) => {
        markEntered = resolve;
      });
      const failures = openFailures.get(id) ?? [];
      failures.push({ failure, gate, markEntered });
      openFailures.set(id, failures);
      return { entered, release };
    },
  };
  const publish = (snapshot: PlaygroundCatalogSnapshot): PlaygroundCatalogSnapshot => {
    state.catalog = snapshot;
    for (const listener of listeners) listener(snapshot);
    return snapshot;
  };
  const mutate = <T>(name: string, operation: () => T): Promise<T> => {
    if (state.failNextMutation !== null) {
      const failure = state.failNextMutation;
      state.failNextMutation = null;
      return Promise.reject(failure);
    }
    const failures = mutationFailures.get(name);
    const failure = failures?.shift();
    if (failures?.length === 0) mutationFailures.delete(name);
    if (failure !== undefined) return Promise.reject(failure);
    return Promise.resolve(operation());
  };
  const defineProject = ((projectPlan: PlaygroundProjectPlan) => {
    events.push(`define:${projectPlan.id}`);
    const definition = Object.freeze({}) as ProjectDefinition<unknown>;
    definitions.set(definition, projectPlan);
    return definition;
  }) as PlaygroundWorkbench['playground']['define'];
  const workbench = {
    health: health(),
    snapshot: () => ({
      storage: { policy: 'ephemeral', backend: 'memory', durability: 'ephemeral' } as const,
    }),
    playground: {
      define: defineProject,
      catalog: {
        snapshot: () => state.catalog,
        subscribe(listener: (snapshot: PlaygroundCatalogSnapshot) => void) {
          listeners.add(listener);
          listener(state.catalog);
          return () => listeners.delete(listener);
        },
        createScratch: ({ definition }: { readonly definition: ProjectDefinition<unknown> }) =>
          mutate('create:scratch', () => {
            events.push('catalog:create:scratch');
            const projectPlan = definitions.get(definition as object);
            if (projectPlan === undefined) throw new Error('unknown definition');
            return publish(
              Object.freeze({
                active: Object.freeze({ kind: 'scratch' as const }),
                scratch: Object.freeze({
                  starterId: projectPlan.starterId,
                  dirty: false,
                  editedAt: 'now',
                }),
                projects: state.catalog.projects,
              }),
            );
          }),
        saveScratch: ({
          id,
          name,
          definition,
        }: {
          readonly id: string;
          readonly name: string;
          readonly definition: ProjectDefinition<unknown>;
        }) =>
          mutate(`save:${id}`, () => {
            events.push(`catalog:save:${id}`);
            const projectPlan = definitions.get(definition as object);
            if (projectPlan === undefined) throw new Error('unknown definition');
            return publish(
              Object.freeze({
                active: Object.freeze({ kind: 'project' as const, id }),
                scratch: null,
                projects: Object.freeze([
                  ...state.catalog.projects,
                  Object.freeze({ id, name, starterId: projectPlan.starterId, editedAt: 'now' }),
                ]),
              }),
            );
          }),
        activate: (
          target: { readonly kind: 'scratch' } | { readonly kind: 'project'; id: string },
        ) =>
          mutate(`activate:${target.kind === 'scratch' ? 'scratch' : target.id}`, () => {
            events.push(`catalog:activate:${target.kind === 'scratch' ? 'scratch' : target.id}`);
            return publish(Object.freeze({ ...state.catalog, active: Object.freeze(target) }));
          }),
        rename: (id: string, name: string) =>
          mutate(`rename:${id}`, () => {
            events.push(`catalog:rename:${id}`);
            return publish(
              Object.freeze({
                ...state.catalog,
                projects: Object.freeze(
                  state.catalog.projects.map((project) =>
                    project.id === id ? Object.freeze({ ...project, name }) : project,
                  ),
                ),
              }),
            );
          }),
        reset: ({
          target,
        }: {
          readonly target:
            | { readonly kind: 'scratch' }
            | { readonly kind: 'project'; readonly id: string };
          readonly definition: ProjectDefinition<unknown>;
        }) =>
          mutate(`reset:${target.kind === 'scratch' ? 'scratch' : target.id}`, () => {
            events.push(`catalog:reset:${target.kind === 'scratch' ? 'scratch' : target.id}`);
            return publish(state.catalog);
          }),
        delete: (id: string) =>
          mutate(`delete:${id}`, () => {
            events.push(`catalog:delete:${id}`);
            return publish(
              Object.freeze({
                ...state.catalog,
                active:
                  state.catalog.active?.kind === 'project' && state.catalog.active.id === id
                    ? null
                    : state.catalog.active,
                projects: Object.freeze(
                  state.catalog.projects.filter((project) => project.id !== id),
                ),
              }),
            );
          }),
      },
      restoreTerminalState: ({ state }) => state,
      forSession(session: ProjectSession<unknown>) {
        events.push(`tools:${String((session as { readonly id?: string }).id)}`);
        return tools();
      },
    },
    async openProject<TReady>(definition: ProjectDefinition<TReady>, options?: unknown) {
      const projectPlan = definitions.get(definition as object);
      if (projectPlan === undefined) throw new Error('unknown definition');
      const active = state.catalog.active;
      const matchesActive =
        projectPlan.id === 'scratch'
          ? active?.kind === 'scratch'
          : active?.kind === 'project' && active.id === projectPlan.id;
      if (!matchesActive) throw new Error(`cannot open inactive project ${projectPlan.id}`);
      openOptions.push(options);
      events.push(`session:open:${projectPlan.id}`);
      const failures = openFailures.get(projectPlan.id);
      const failure = failures?.shift();
      if (failures?.length === 0) openFailures.delete(projectPlan.id);
      if (failure !== undefined) {
        failure.markEntered?.();
        if (failure.gate !== null) await failure.gate;
        throw failure.failure;
      }
      const session = {
        id: projectPlan.id,
        files: {},
        documents: {},
        run: vi.fn(),
        terminals: { open: vi.fn() },
        async close() {
          events.push(`session:close:${projectPlan.id}`);
          if (state.failNextClose !== null) {
            const failure = state.failNextClose;
            state.failNextClose = null;
            throw failure;
          }
        },
      } as unknown as ProjectSession<unknown>;
      return session as ProjectSession<TReady>;
    },
    deleteProject: vi.fn(),
    async close() {
      events.push('workbench:close');
    },
  } satisfies PlaygroundWorkbench;
  state.workbench = workbench;
  state.runtime = createPlaygroundAppRuntime(
    workbench,
    terminalState === undefined ? {} : { terminalState },
  );
  return state;
}

async function savedProjectPair(
  h: Harness,
): Promise<{ readonly projectA: PlaygroundProjectPlan; readonly projectB: PlaygroundProjectPlan }> {
  const projectA = plan('project-a', 'starter-a');
  const projectB = plan('project-b', 'starter-b');
  await h.runtime.createScratch(plan('scratch', 'starter-a'));
  await h.runtime.saveScratch(projectA, 'Project A');
  await h.runtime.createScratch(plan('scratch', 'starter-b'));
  await h.runtime.saveScratch(projectB, 'Project B');
  h.events.splice(0);
  return { projectA, projectB };
}

describe('Playground App semantic runtime', () => {
  it('reads the latest host terminal snapshot for every semantic project open', async () => {
    let state: ProjectTerminalSnapshot = { cwd: '/src', env: { COLOR: '1' } };
    const h = harness(() => state);

    await h.runtime.createScratch(plan('scratch'));
    state = { cwd: '/nested', env: { COLOR: '2' } };
    await h.runtime.reset(plan('scratch'));

    expect(h.openOptions).toEqual([
      { initialTerminalState: { cwd: '/src', env: { COLOR: '1' } } },
      { initialTerminalState: { cwd: '/nested', env: { COLOR: '2' } } },
    ]);
  });

  it('owns one session at a time and routes Starter creation through define → catalog → open → forSession', async () => {
    const h = harness();

    const context = await h.runtime.createScratch(plan('scratch'));

    expect(context.plan.id).toBe('scratch');
    expect(h.runtime.current()).toBe(context);
    expect(h.events).toEqual([
      'define:scratch',
      'catalog:create:scratch',
      'session:open:scratch',
      'tools:scratch',
    ]);
  });

  it('keeps the live session for the catalog metadata-only rename allowed by ADR 0277', async () => {
    const h = harness();
    await h.runtime.createScratch(plan('scratch'));
    await h.runtime.saveScratch(plan('project-a'), 'Project A');
    h.events.splice(0);

    const renamed = await h.runtime.rename('project-a', 'Renamed');

    expect(renamed?.plan.id).toBe('project-a');
    expect(h.events).toEqual(['catalog:rename:project-a']);
  });

  it('restores the prior active session when a catalog mutation fails after close', async () => {
    const h = harness();
    await h.runtime.createScratch(plan('scratch'));
    h.events.splice(0);
    h.failNextMutation = new Error('quota');

    await expect(h.runtime.reset(plan('scratch'))).rejects.toThrow('quota');

    expect(h.runtime.current()?.plan.id).toBe('scratch');
    expect(h.events).toEqual([
      'define:scratch',
      'session:close:scratch',
      'session:open:scratch',
      'tools:scratch',
    ]);
  });

  it('restores the prior catalog ref and live session before target-open mismatch rejects', async () => {
    const h = harness();
    const { projectA, projectB } = await savedProjectPair(h);
    const mismatch = new ProjectDefinitionMismatchError(projectA.id);
    h.failOpen(projectA.id, mismatch);

    await expect(h.runtime.activate(projectA)).rejects.toBe(mismatch);

    expect(h.catalog.active).toEqual({ kind: 'project', id: projectB.id });
    expect(h.runtime.current()?.plan).toEqual(projectB);
    expect(h.events).toEqual([
      'define:project-a',
      'session:close:project-b',
      'catalog:activate:project-a',
      'session:open:project-a',
      'catalog:activate:project-b',
      'session:open:project-b',
      'tools:project-b',
    ]);
  });

  it('preserves target-open failure first when prior catalog reactivation fails', async () => {
    const h = harness();
    const { projectA, projectB } = await savedProjectPair(h);
    const mismatch = new ProjectDefinitionMismatchError(projectA.id);
    const restoreFailure = new Error('prior catalog reactivation failed');
    h.failOpen(projectA.id, mismatch);
    h.failMutation(`activate:${projectB.id}`, restoreFailure);

    const failure = await h.runtime.activate(projectA).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([mismatch, restoreFailure]);
    expect(h.catalog.active).toEqual({ kind: 'project', id: projectA.id });
    expect(h.runtime.current()).toBeNull();
  });

  it('preserves target-open failure first when prior reopen fails and admits a later retry', async () => {
    const h = harness();
    const { projectA, projectB } = await savedProjectPair(h);
    const mismatch = new ProjectDefinitionMismatchError(projectA.id);
    const restoreFailure = new Error('prior session reopen failed');
    h.failOpen(projectA.id, mismatch);
    h.failOpen(projectB.id, restoreFailure);

    const failure = await h.runtime.activate(projectA).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([mismatch, restoreFailure]);
    expect(h.catalog.active).toEqual({ kind: 'project', id: projectB.id });
    expect(h.runtime.current()).toBeNull();

    h.events.splice(0);
    const retried = await h.runtime.activate(projectB);

    expect(retried.plan).toEqual(projectB);
    expect(h.runtime.current()).toBe(retried);
    expect(h.events).toEqual([
      'define:project-b',
      'catalog:activate:project-b',
      'session:open:project-b',
      'tools:project-b',
    ]);
  });

  it('queues close behind target-open compensation and drains the restored session', async () => {
    const h = harness();
    const { projectA } = await savedProjectPair(h);
    const mismatch = new ProjectDefinitionMismatchError(projectA.id);
    const targetOpen = h.deferOpenFailure(projectA.id, mismatch);

    const activation = h.runtime.activate(projectA);
    await targetOpen.entered;
    const closing = h.runtime.close();
    await Promise.resolve();

    expect(h.events).toEqual([
      'define:project-a',
      'session:close:project-b',
      'catalog:activate:project-a',
      'session:open:project-a',
    ]);

    targetOpen.release();
    await expect(activation).rejects.toBe(mismatch);
    await expect(closing).resolves.toBeUndefined();

    expect(h.runtime.current()).toBeNull();
    expect(h.events).toEqual([
      'define:project-a',
      'session:close:project-b',
      'catalog:activate:project-a',
      'session:open:project-a',
      'catalog:activate:project-b',
      'session:open:project-b',
      'tools:project-b',
      'session:close:project-b',
      'workbench:close',
    ]);
  });

  it('resets an inactive project and restores the catalog-active session', async () => {
    const h = harness();
    await h.runtime.createScratch(plan('scratch'));
    await h.runtime.saveScratch(plan('project-a'), 'Project A');
    await h.runtime.createScratch(plan('scratch', 'starter-b'));
    h.events.splice(0);

    const restored = await h.runtime.reset(plan('project-a'));

    expect(restored?.plan).toEqual(plan('scratch', 'starter-b'));
    expect(h.runtime.current()).toBe(restored);
    expect(h.events).toEqual([
      'define:project-a',
      'session:close:scratch',
      'catalog:reset:project-a',
      'session:open:scratch',
      'tools:scratch',
    ]);
  });

  it.each([
    new DirtyProjectDocumentError('/src/main.ts'),
    new ProjectDocumentSaveInProgressError('/src/main.ts'),
  ])(
    'does not mutate the catalog when retryable close preflight rejects with %s',
    async (error) => {
      const h = harness();
      const context = await h.runtime.createScratch(plan('scratch'));
      h.events.splice(0);
      h.failNextClose = error;

      await expect(h.runtime.createScratch(plan('scratch', 'starter-b'))).rejects.toBe(error);

      expect(h.runtime.current()).toBe(context);
      expect(h.events).toEqual(['define:scratch', 'session:close:scratch']);
    },
  );

  it('retires the active context when admitted session teardown fails terminally', async () => {
    const h = harness();
    await h.runtime.createScratch(plan('scratch'));
    h.events.splice(0);
    const failure = new Error('terminal close failed');
    h.failNextClose = failure;

    await expect(h.runtime.createScratch(plan('scratch', 'starter-b'))).rejects.toBe(failure);

    expect(h.runtime.current()).toBeNull();
    expect(h.events).toEqual(['define:scratch', 'session:close:scratch']);
  });

  it('serializes concurrent UI transitions before they reach the owner authority', async () => {
    const h = harness();

    await Promise.all([
      h.runtime.createScratch(plan('scratch', 'starter-a')),
      h.runtime.createScratch(plan('scratch', 'starter-b')),
    ]);

    expect(h.events).toEqual([
      'define:scratch',
      'catalog:create:scratch',
      'session:open:scratch',
      'tools:scratch',
      'define:scratch',
      'session:close:scratch',
      'catalog:create:scratch',
      'session:open:scratch',
      'tools:scratch',
    ]);
    expect(h.runtime.current()?.plan.starterId).toBe('starter-b');
  });

  it('drains the session before the one Workbench owner', async () => {
    const h = harness();
    await h.runtime.createScratch(plan('scratch'));
    h.events.splice(0);

    await h.runtime.close();

    expect(h.events).toEqual(['session:close:scratch', 'workbench:close']);
    expect(h.runtime.current()).toBeNull();
  });

  it('coalesces repeated App cleanup onto one Workbench close', async () => {
    const h = harness();

    const first = h.runtime.close();
    const second = h.runtime.close();

    expect(second).toBe(first);
    await first;
    expect(h.events).toEqual(['workbench:close']);
  });
});
