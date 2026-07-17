import { describe, expect, it, vi } from 'vitest';
import type {
  PlaygroundCatalogSnapshot,
  PlaygroundProjectPlan,
  PlaygroundSessionTools,
  PlaygroundWorkbench,
} from '../workbench/playground.ts';
import {
  DirtyProjectDocumentError,
  type ProjectDefinition,
  ProjectDocumentSaveInProgressError,
  type ProjectSession,
  type ProjectTerminalSnapshot,
} from '../workbench/public.ts';
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

function tools(): PlaygroundSessionTools {
  return Object.freeze({
    typescript: {} as PlaygroundSessionTools['typescript'],
    scm: {} as PlaygroundSessionTools['scm'],
    archive: {} as PlaygroundSessionTools['archive'],
    previews: {} as PlaygroundSessionTools['previews'],
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
}

function harness(terminalState?: () => ProjectTerminalSnapshot): Harness {
  const events: string[] = [];
  const openOptions: unknown[] = [];
  const definitions = new WeakMap<object, PlaygroundProjectPlan>();
  const listeners = new Set<(snapshot: PlaygroundCatalogSnapshot) => void>();
  const state: Harness = {
    runtime: undefined as never,
    workbench: undefined as never,
    events,
    openOptions,
    catalog: EMPTY_CATALOG,
    failNextMutation: null,
    failNextClose: null,
  };
  const publish = (snapshot: PlaygroundCatalogSnapshot): PlaygroundCatalogSnapshot => {
    state.catalog = snapshot;
    for (const listener of listeners) listener(snapshot);
    return snapshot;
  };
  const mutate = <T>(operation: () => T): Promise<T> => {
    if (state.failNextMutation !== null) {
      const failure = state.failNextMutation;
      state.failNextMutation = null;
      return Promise.reject(failure);
    }
    return Promise.resolve(operation());
  };
  const defineProject = ((projectPlan: PlaygroundProjectPlan) => {
    events.push(`define:${projectPlan.id}`);
    const definition = Object.freeze({}) as ProjectDefinition<unknown>;
    definitions.set(definition, projectPlan);
    return definition;
  }) as PlaygroundWorkbench['playground']['define'];
  const workbench = {
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
          mutate(() => {
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
          mutate(() => {
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
          mutate(() => {
            events.push(`catalog:activate:${target.kind === 'scratch' ? 'scratch' : target.id}`);
            return publish(Object.freeze({ ...state.catalog, active: Object.freeze(target) }));
          }),
        rename: (id: string, name: string) =>
          mutate(() => {
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
          mutate(() => {
            events.push(`catalog:reset:${target.kind === 'scratch' ? 'scratch' : target.id}`);
            return publish(state.catalog);
          }),
        delete: (id: string) =>
          mutate(() => {
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
});
