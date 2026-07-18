import { EventEmitter } from 'node:events';
import type { WorkerProcessHandle } from '@riftydev/kernel';
import { SW_FRAME_VERSION, SW_PONG, SW_ROUTING_VERSION } from '@riftydev/service-worker';
import { describe, expect, it, vi } from 'vitest';
import type { VfsSnapshotEntry } from '../glue/vfs-snapshot-port.ts';
import {
  DirtyProjectDocumentError,
  ProjectDefinitionMismatchError,
  ProjectFileOperationError,
  RuntimeAssetError,
  type RuntimeAssetProgress,
} from './errors.ts';
import type { PageToPlaygroundOwnerMessage } from './internal/playground-owner-protocol.ts';
import { definePlaygroundProject } from './internal/playground-project-definition.ts';
import type { PageToWorkbenchOwnerMessage } from './owner-protocol.ts';
import {
  defineNodeCliProject,
  defineNodeServerProject,
  inspectProjectDefinition,
  projects,
} from './project-definition.ts';
import { startBrowserWorkspaceOwner, workbenchOwnerSpawnSpec } from './workbench-browser-owner.ts';
import type { WorkbenchOwnerStartInput } from './workbench-owner-port.ts';

const input: WorkbenchOwnerStartInput = Object.freeze({
  deployment: Object.freeze({
    workers: Object.freeze({
      owner: '/workers/workbench-owner.js',
      kernel: '/workers/kernel.js',
      node: '/workers/node.js',
      devServer: '/workers/dev-server.js',
    }),
    wasm: Object.freeze({ sqlite: '/wasm/sqlite.wasm', esbuild: '/wasm/esbuild.wasm' }),
    previewProbeTimeoutMs: 1_000,
  }),
  packageAcquisition: Object.freeze({ registryUrl: '/npm-registry' }),
  storage: Object.freeze({ persistence: 'ephemeral' as const }),
});
const encoder = new TextEncoder();
const playgroundUrlContext = Object.freeze({
  apiBaseUrl: 'https://playground.test/app/',
  clientUrl: 'https://playground.test/app/index.html',
});
const companionInput: WorkbenchOwnerStartInput = Object.freeze({
  ...input,
  legacyWorkspacePrefix: '/workspaces/vite',
  playgroundUrlContext,
});
const runtimeAssetA = 'esbuild-wasm@0.28.0/package/esbuild.wasm';
const runtimeAssetB = 'esbuild-wasm@0.28.0/package/esbuild.worker.js';

function assetProgress(
  phase: 'cache-check' | 'fetch' | 'verify' | 'persist',
  assetIndex: number,
  assetCount: number,
  assetId = runtimeAssetA,
): RuntimeAssetProgress {
  return { phase, assetId, assetIndex, assetCount };
}

function readyProgress(assetCount: number): RuntimeAssetProgress {
  return {
    phase: 'ready',
    requiredSetDigest: 'b'.repeat(64),
    assetCount,
    storageClass: 'memory-session',
  };
}

type PageToPhysicalOwnerMessage = PageToWorkbenchOwnerMessage | PageToPlaygroundOwnerMessage;

class FakeOwnerWorker extends EventEmitter {
  readonly kind = 'worker' as const;
  readonly sent: PageToPhysicalOwnerMessage[] = [];
  readonly output = new EventEmitter();
  killedWith: string | null = null;

  send(message: unknown): boolean {
    this.sent.push(message as PageToPhysicalOwnerMessage);
    return true;
  }

  stdout(): EventEmitter {
    return this.output;
  }

  stderr(): EventEmitter {
    return this.output;
  }

  kill(signal = 'SIGTERM'): boolean {
    this.killedWith = signal;
    this.emit('exit', null, signal);
    return true;
  }
}

class ControlledServiceWorker {
  readonly messages: unknown[] = [];
  readonly replyPorts: MessagePort[] = [];

  postMessage(message: unknown, transfer: Transferable[]): void {
    this.messages.push(message);
    const replyPort = transfer[0];
    if (!(replyPort instanceof MessagePort)) throw new Error('control PING omitted reply port');
    this.replyPorts.push(replyPort);
  }
}

class ControlledServiceWorkerContainer {
  readonly controller = new ControlledServiceWorker();
  readonly #listeners = new Map<'controllerchange' | 'message', Set<EventListener>>();

  addEventListener(type: 'controllerchange' | 'message', listener: EventListener): void {
    const listeners = this.#listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  removeEventListener(type: 'controllerchange' | 'message', listener: EventListener): void {
    this.#listeners.get(type)?.delete(listener);
  }

  pong(at: number): void {
    const port = this.controller.replyPorts[at];
    if (port === undefined) throw new Error(`missing control reply port ${String(at)}`);
    port.postMessage({
      type: SW_PONG,
      from: 'service-worker',
      frameVersion: SW_FRAME_VERSION,
      routingVersion: SW_ROUTING_VERSION,
    });
  }
}

async function settleMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

type ProgressOpenKind = 'generic' | 'companion';

async function beginProgressOpen(kind: ProgressOpenKind, worker: FakeOwnerWorker) {
  const raw = startBrowserWorkspaceOwner(
    kind === 'generic' ? input : companionInput,
    dependencies(worker),
  );
  worker.emit('message', {
    type: 'workbench:owner-ready',
    storage: { policy: 'ephemeral', backend: 'memory', durability: 'ephemeral' },
  });
  if (kind === 'companion') {
    worker.emit('message', {
      type: 'workbench:playground-ready',
      catalog: {
        active: { kind: 'scratch' },
        scratch: { starterId: 'vite', dirty: false, editedAt: '2026-07-18T00:00:00.000Z' },
        projects: [],
      },
    });
  }
  await raw.ready;
  if (kind === 'generic') {
    const opening = raw.openProject(
      inspectProjectDefinition(projects.vite({ id: 'strict-progress', files: {} })),
    );
    const request = sentOf(worker, 'workbench:open-project').at(-1);
    if (request === undefined) throw new Error('missing generic progress open request');
    return { raw, opening: opening as Promise<unknown>, opId: request.opId };
  }
  const companion = raw.playground;
  if (companion === undefined) throw new Error('missing Playground companion handle');
  const opening = companion.openProject(
    definePlaygroundProject(
      {
        kind: 'vite',
        id: 'scratch',
        starterId: 'vite',
        templateId: 'vite',
        files: {},
        firstMaterialization: { kind: 'install' },
        port: 4173,
      },
      playgroundUrlContext,
    ),
  );
  const request = sentPlaygroundOf(worker, 'workbench:playground-open-project').at(-1);
  if (request === undefined) throw new Error('missing companion progress open request');
  return { raw, opening: opening as Promise<unknown>, opId: request.opId };
}

function dependencies(worker: FakeOwnerWorker) {
  let operationSequence = 0;
  return {
    spawnOwner: vi.fn(() => worker as unknown as WorkerProcessHandle),
    serviceWorker: {
      controller: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
    timers: {
      setTimeout: vi.fn(() => 1),
      clearTimeout: vi.fn(),
    },
    fetch: vi.fn(async () => new Response('ok')),
    mountPreview: vi.fn(() => () => {}),
    operationId: () => `operation-${String(++operationSequence)}`,
  };
}

function sentOf<T extends PageToWorkbenchOwnerMessage['type']>(
  worker: FakeOwnerWorker,
  type: T,
): Extract<PageToWorkbenchOwnerMessage, { readonly type: T }>[] {
  return worker.sent.filter(
    (message): message is Extract<PageToWorkbenchOwnerMessage, { readonly type: T }> =>
      message.type === type,
  );
}

function sentPlaygroundOf<T extends PageToPlaygroundOwnerMessage['type']>(
  worker: FakeOwnerWorker,
  type: T,
): Extract<PageToPlaygroundOwnerMessage, { readonly type: T }>[] {
  return worker.sent.filter(
    (message): message is Extract<PageToPlaygroundOwnerMessage, { readonly type: T }> =>
      message.type === type,
  );
}

async function acceptOpenedProject(
  worker: FakeOwnerWorker,
  openRequest: Extract<PageToWorkbenchOwnerMessage, { readonly type: 'workbench:open-project' }>,
  projectToken: string,
  projectRoot: string,
  entries: readonly VfsSnapshotEntry[] = [],
): Promise<void> {
  worker.emit('message', {
    type: 'workbench:project-opened',
    opId: openRequest.opId,
    projectToken,
    projectRoot,
  });
  await acceptProjectSnapshot(worker, projectToken, projectRoot, entries);
}

async function acceptProjectSnapshot(
  worker: FakeOwnerWorker,
  projectToken: string,
  projectRoot: string,
  entries: readonly VfsSnapshotEntry[] = [],
): Promise<void> {
  await settleMicrotasks();
  const snapshotRequest = sentOf(worker, 'workbench:project-vfs').find(
    (message) => message.frame.type === 'workbench:project-vfs-snapshot-request',
  );
  expect(snapshotRequest).toEqual({
    type: 'workbench:project-vfs',
    projectToken,
    frame: { type: 'workbench:project-vfs-snapshot-request' },
  });
  worker.emit('message', {
    type: 'workbench:project-vfs',
    projectToken,
    frame: {
      type: 'workbench:project-vfs-snapshot',
      frame: {
        type: 'snapshot',
        root: projectRoot,
        ownerEpoch: `epoch:${projectToken}`,
        treeRevision: 1,
        entries,
        nodeModulesPresent: false,
      },
    },
  });
}

describe('browser Workbench owner transport', () => {
  it('spawns one run-to-completion owner with no config or binding in process env', () => {
    expect(workbenchOwnerSpawnSpec(input)).toEqual({
      entry: { kind: 'url', url: '/workers/workbench-owner.js' },
      argv: ['rifty', 'workbench-owner'],
      env: {},
      cwd: '/',
      serve: false,
    });
  });

  it('owns one generic open callback page-side and isolates its failures from later phases', async () => {
    const worker = new FakeOwnerWorker();
    const raw = startBrowserWorkspaceOwner(input, dependencies(worker));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      worker.emit('message', {
        type: 'workbench:owner-ready',
        storage: { policy: 'ephemeral', backend: 'memory', durability: 'ephemeral' },
      });
      await raw.ready;
      const callback = vi.fn((_progress: RuntimeAssetProgress) => {
        throw new Error('page observer failed');
      });
      const opening = raw.openProject(
        inspectProjectDefinition(projects.vite({ id: 'progress', files: {} })),
        { onRuntimeAssetProgress: callback },
      );
      const request = sentOf(worker, 'workbench:open-project')[0];
      if (request === undefined) throw new Error('missing progress open request');
      expect(request).not.toHaveProperty('onRuntimeAssetProgress');

      for (const progress of [
        assetProgress('cache-check', 0, 1),
        assetProgress('fetch', 0, 1),
        assetProgress('verify', 0, 1),
        assetProgress('persist', 0, 1),
      ]) {
        worker.emit('message', {
          type: 'workbench:runtime-assets-progress',
          opId: request.opId,
          progress,
        });
      }

      expect(callback).toHaveBeenCalledTimes(4);
      expect(callback.mock.calls[0]?.[0]).toEqual(assetProgress('cache-check', 0, 1));
      expect(Object.isFrozen(callback.mock.calls[0]?.[0])).toBe(true);
      expect(warning).toHaveBeenCalledTimes(1);
      expect(warning.mock.calls[0]?.[0]).toContain(request.opId);
      expect(worker.killedWith).toBeNull();

      worker.emit('message', {
        type: 'workbench:failure',
        opId: request.opId,
        error: { name: 'Error', message: 'open stopped by fixture' },
      });
      await expect(opening).rejects.toThrow('open stopped by fixture');
      raw.close();
      worker.emit('exit', 0, null);
      await raw.closed;
    } finally {
      warning.mockRestore();
    }
  });

  it('routes companion open progress through the same page-owned observer', async () => {
    const worker = new FakeOwnerWorker();
    const raw = startBrowserWorkspaceOwner(companionInput, dependencies(worker));
    const companion = raw.playground;
    if (companion === undefined) throw new Error('missing Playground companion handle');
    worker.emit('message', {
      type: 'workbench:owner-ready',
      storage: { policy: 'ephemeral', backend: 'memory', durability: 'ephemeral' },
    });
    worker.emit('message', {
      type: 'workbench:playground-ready',
      catalog: {
        active: { kind: 'scratch' },
        scratch: { starterId: 'vite', dirty: false, editedAt: '2026-07-18T00:00:00.000Z' },
        projects: [],
      },
    });
    await raw.ready;
    const callback = vi.fn();
    const definition = definePlaygroundProject(
      {
        kind: 'vite',
        id: 'scratch',
        starterId: 'vite',
        templateId: 'vite',
        files: {},
        firstMaterialization: { kind: 'install' },
        port: 4173,
      },
      playgroundUrlContext,
    );
    const opening = companion.openProject(definition, { onRuntimeAssetProgress: callback });
    const request = sentPlaygroundOf(worker, 'workbench:playground-open-project')[0];
    if (request === undefined) throw new Error('missing Playground progress open request');
    expect(request).not.toHaveProperty('onRuntimeAssetProgress');

    for (const progress of [
      assetProgress('cache-check', 0, 1),
      assetProgress('verify', 0, 1),
      readyProgress(1),
    ]) {
      worker.emit('message', {
        type: 'workbench:runtime-assets-progress',
        opId: request.opId,
        progress,
      });
    }
    expect(callback.mock.calls.map(([progress]) => progress)).toEqual([
      assetProgress('cache-check', 0, 1),
      assetProgress('verify', 0, 1),
      readyProgress(1),
    ]);

    worker.emit('message', {
      type: 'workbench:failure',
      opId: request.opId,
      error: { name: 'Error', message: 'companion open stopped by fixture' },
    });
    await expect(opening).rejects.toThrow('companion open stopped by fixture');
    raw.close();
    worker.emit('exit', 0, null);
    await raw.closed;
  });

  it('fails the owner protocol for progress from an unknown operation', async () => {
    const worker = new FakeOwnerWorker();
    const raw = startBrowserWorkspaceOwner(input, dependencies(worker));
    worker.emit('message', {
      type: 'workbench:owner-ready',
      storage: { policy: 'ephemeral', backend: 'memory', durability: 'ephemeral' },
    });
    await raw.ready;
    const opening = raw.openProject(
      inspectProjectDefinition(projects.vite({ id: 'strict-progress', files: {} })),
    );
    const request = sentOf(worker, 'workbench:open-project')[0];
    if (request === undefined) throw new Error('missing strict progress open request');
    worker.emit('message', {
      type: 'workbench:runtime-assets-progress',
      opId: 'never-issued',
      progress: assetProgress('cache-check', 0, 1),
    });

    expect(worker.killedWith).toBe('SIGTERM');
    await expect(opening).rejects.toThrow(/runtime-asset progress/i);
    await expect(raw.closed).rejects.toThrow(/runtime-asset progress/i);
  });

  describe.each(['generic', 'companion'] as const)('%s open progress protocol', (kind) => {
    it.each([
      {
        name: 'first phase is not cache-check',
        before: [assetProgress('verify', 0, 1)],
      },
      {
        name: 'one asset identity is reused at two indexes',
        before: [
          assetProgress('cache-check', 0, 2, runtimeAssetA),
          assetProgress('cache-check', 1, 2, runtimeAssetA),
        ],
      },
      {
        name: 'persist skips verify',
        before: [
          assetProgress('cache-check', 0, 1),
          assetProgress('fetch', 0, 1),
          assetProgress('persist', 0, 1),
        ],
      },
      {
        name: 'asset index is out of range',
        before: [assetProgress('cache-check', 1, 1, runtimeAssetB)],
      },
      {
        name: 'asset index is missing',
        before: [
          {
            phase: 'cache-check',
            assetId: runtimeAssetA,
            assetCount: 1,
          },
        ],
      },
      {
        name: 'ready arrives before every index was checked',
        before: [assetProgress('cache-check', 0, 2), readyProgress(2)],
      },
      {
        name: 'ready arrives before the checked asset was verified',
        before: [assetProgress('cache-check', 0, 1), readyProgress(1)],
      },
      {
        name: 'project-opened terminates a partial trace without ready',
        before: [assetProgress('cache-check', 0, 1)],
        terminal: 'opened' as const,
      },
      {
        name: 'one phase is duplicated',
        before: [assetProgress('cache-check', 0, 1), assetProgress('cache-check', 0, 1)],
      },
      {
        name: 'progress arrives after a failed terminal',
        before: [],
        terminal: 'failure' as const,
        after: [assetProgress('cache-check', 0, 1)],
      },
      {
        name: 'progress follows ready',
        before: [
          assetProgress('cache-check', 0, 1),
          readyProgress(1),
          assetProgress('fetch', 0, 1),
        ],
      },
    ])('rejects corrupt-input: $name', async ({ before, terminal, after = [] }) => {
      const worker = new FakeOwnerWorker();
      const { raw, opening, opId } = await beginProgressOpen(kind, worker);
      void opening.catch(() => undefined);
      for (const progress of before) {
        worker.emit('message', {
          type: 'workbench:runtime-assets-progress',
          opId,
          progress,
        });
      }
      if (terminal === 'failure') {
        worker.emit('message', {
          type: 'workbench:failure',
          opId,
          error: { name: 'Error', message: 'open stopped by fixture' },
        });
        await expect(opening).rejects.toThrow('open stopped by fixture');
      } else if (terminal === 'opened') {
        worker.emit(
          'message',
          kind === 'generic'
            ? {
                type: 'workbench:project-opened',
                opId,
                projectToken: 'partial-generic-token',
                projectRoot: '/owner-born/partial-generic',
              }
            : {
                type: 'workbench:playground-project-opened',
                opId,
                projectToken: 'partial-companion-token',
                projectRoot: '/owner-born/partial-companion',
                acquisition: { kind: 'install', snapshotFailures: [] },
                runtime: { kind: 'vite', port: 4173 },
                initialScmSnapshot: { history: [], changes: [] },
              },
        );
      }
      for (const progress of after) {
        worker.emit('message', {
          type: 'workbench:runtime-assets-progress',
          opId,
          progress,
        });
      }

      expect(worker.killedWith).toBe('SIGTERM');
      await expect(raw.closed).rejects.toThrow(/runtime[- ]asset progress|assetIndex/i);
    });
  });

  it('correlates runtime-asset admin terminals and reconstructs only the safe public error', async () => {
    const worker = new FakeOwnerWorker();
    const raw = startBrowserWorkspaceOwner(input, dependencies(worker));
    worker.emit('message', {
      type: 'workbench:owner-ready',
      storage: { policy: 'ephemeral', backend: 'memory', durability: 'ephemeral' },
    });
    await raw.ready;

    const inspection = Object.freeze({
      storageClass: 'memory-session' as const,
      entryCount: 3,
      storedBytes: 30,
      verifiedObjectCount: 1,
      verifiedObjectBytes: 10,
      readySetCount: 1,
    });
    const inspecting = raw.inspectRuntimeAssets();
    const inspectRequest = sentOf(worker, 'workbench:runtime-assets-inspect').at(-1);
    if (inspectRequest === undefined) throw new Error('missing runtime asset inspect request');
    worker.emit('message', {
      type: 'workbench:runtime-assets-inspected',
      opId: inspectRequest.opId,
      inspection,
    });
    await expect(inspecting).resolves.toEqual(inspection);

    const clearing = raw.clearRuntimeAssets();
    const clearRequest = sentOf(worker, 'workbench:runtime-assets-clear').at(-1);
    if (clearRequest === undefined) throw new Error('missing runtime asset clear request');
    worker.emit('message', {
      type: 'workbench:failure',
      opId: clearRequest.opId,
      error: {
        name: 'RuntimeAssetError',
        code: 'ESHADOWASSET',
        message: 'Runtime asset cache clear failed',
        phase: 'clear',
        recovery: 'clear-and-retry',
        usedBytes: 30,
        requiredBytes: 40,
      },
    });
    const failure = await clearing.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RuntimeAssetError);
    expect(failure).toMatchObject({
      code: 'ESHADOWASSET',
      phase: 'clear',
      recovery: 'clear-and-retry',
      usedBytes: 30,
      requiredBytes: 40,
    });
    expect(Object.keys(failure as object).sort()).toEqual([
      'code',
      'name',
      'phase',
      'recovery',
      'requiredBytes',
      'usedBytes',
    ]);

    raw.close();
    worker.emit('exit', 0, null);
    await raw.closed;
  });

  it('poisons before sending when an admin operation id is reused after settlement', async () => {
    const worker = new FakeOwnerWorker();
    const raw = startBrowserWorkspaceOwner(input, {
      ...dependencies(worker),
      operationId: () => 'reused-admin-operation',
    });
    worker.emit('message', {
      type: 'workbench:owner-ready',
      storage: { policy: 'ephemeral', backend: 'memory', durability: 'ephemeral' },
    });
    await raw.ready;

    const first = raw.inspectRuntimeAssets();
    const firstRequest = sentOf(worker, 'workbench:runtime-assets-inspect')[0];
    if (firstRequest === undefined) throw new Error('missing first runtime asset inspect request');
    worker.emit('message', {
      type: 'workbench:runtime-assets-inspected',
      opId: firstRequest.opId,
      inspection: {
        storageClass: 'memory-session',
        entryCount: 0,
        storedBytes: 0,
        verifiedObjectCount: 0,
        verifiedObjectBytes: 0,
        readySetCount: 0,
      },
    });
    await first;

    const reused = raw.inspectRuntimeAssets();

    await expect(reused).rejects.toThrow(/duplicate.*reused-admin-operation/i);
    expect(sentOf(worker, 'workbench:runtime-assets-inspect')).toHaveLength(1);
    expect(worker.killedWith).toBe('SIGTERM');
    await expect(raw.closed).rejects.toThrow(/duplicate.*reused-admin-operation/i);
  });

  it('poisons the owner transport on a wrong runtime-asset terminal kind', async () => {
    const worker = new FakeOwnerWorker();
    const raw = startBrowserWorkspaceOwner(input, dependencies(worker));
    worker.emit('message', {
      type: 'workbench:owner-ready',
      storage: { policy: 'ephemeral', backend: 'memory', durability: 'ephemeral' },
    });
    await raw.ready;

    const clearing = raw.clearRuntimeAssets();
    const request = sentOf(worker, 'workbench:runtime-assets-clear').at(-1);
    if (request === undefined) throw new Error('missing runtime asset clear request');
    worker.emit('message', {
      type: 'workbench:runtime-assets-inspected',
      opId: request.opId,
      inspection: {
        storageClass: 'memory-session',
        entryCount: 0,
        storedBytes: 0,
        verifiedObjectCount: 0,
        verifiedObjectBytes: 0,
        readySetCount: 0,
      },
    });

    await expect(clearing).rejects.toThrow(/unexpected.*runtime-assets-inspect/i);
    await expect(raw.closed).rejects.toThrow(/unexpected.*runtime-assets-inspect/i);
    expect(worker.killedWith).toBe('SIGTERM');
  });

  it('admits a companion only after both readiness frames and maintains one exact catalog proxy', async () => {
    const worker = new FakeOwnerWorker();
    const raw = startBrowserWorkspaceOwner(companionInput, dependencies(worker));
    const companion = raw.playground;
    if (companion === undefined) throw new Error('missing Playground companion handle');

    let ready = false;
    void raw.ready.then(() => {
      ready = true;
    });
    worker.emit('message', {
      type: 'workbench:owner-ready',
      storage: { policy: 'ephemeral', backend: 'memory', durability: 'ephemeral' },
    });
    await settleMicrotasks();
    expect(ready).toBe(false);

    const initial = {
      active: { kind: 'project', id: 'project-a' },
      scratch: null,
      projects: [
        {
          id: 'project-a',
          name: 'Project A',
          starterId: 'vite',
          editedAt: '2026-07-16T12:00:00.000Z',
        },
      ],
    };
    worker.emit('message', { type: 'workbench:playground-ready', catalog: initial });
    await raw.ready;

    const admitted = companion.catalog.snapshot();
    expect(admitted).toEqual(initial);
    expect(Object.isFrozen(admitted)).toBe(true);
    expect(Object.isFrozen(admitted.active)).toBe(true);
    expect(Object.isFrozen(admitted.projects)).toBe(true);
    expect(Object.isFrozen(admitted.projects[0])).toBe(true);

    const observed: unknown[] = [];
    const unsubscribe = companion.catalog.subscribe((snapshot) => observed.push(snapshot));
    expect(observed).toEqual([admitted]);

    const renaming = companion.catalog.rename('project-a', 'Renamed');
    const request = sentPlaygroundOf(worker, 'workbench:playground-catalog').at(-1);
    expect(request).toEqual({
      type: 'workbench:playground-catalog',
      opId: expect.any(String),
      command: { kind: 'rename', id: 'project-a', name: 'Renamed' },
    });
    if (request === undefined) throw new Error('missing Playground catalog request');
    let mutationSettled = false;
    void renaming.then(() => {
      mutationSettled = true;
    });

    const updated = {
      ...initial,
      projects: [{ ...initial.projects[0], name: 'Renamed' }],
    };
    worker.emit('message', { type: 'workbench:playground-catalog-updated', catalog: updated });
    await settleMicrotasks();
    expect(mutationSettled).toBe(false);
    expect(observed).toEqual([admitted, companion.catalog.snapshot()]);
    expect(Object.isFrozen(companion.catalog.snapshot().projects[0])).toBe(true);

    worker.emit('message', {
      type: 'workbench:playground-catalog-completed',
      opId: request.opId,
    });
    await expect(renaming).resolves.toBe(companion.catalog.snapshot());
    unsubscribe();

    raw.close();
    worker.emit('exit', 0, null);
    await raw.closed;
  });

  it('opens the semantic companion project with owner decisions and token-gates session tools', async () => {
    const worker = new FakeOwnerWorker();
    const serviceWorker = new ControlledServiceWorkerContainer();
    const deps = { ...dependencies(worker), serviceWorker };
    const raw = startBrowserWorkspaceOwner(companionInput, deps);
    const companion = raw.playground;
    if (companion === undefined) throw new Error('missing Playground companion handle');
    worker.emit('message', {
      type: 'workbench:owner-ready',
      storage: { policy: 'ephemeral', backend: 'memory', durability: 'ephemeral' },
    });
    worker.emit('message', {
      type: 'workbench:playground-ready',
      catalog: {
        active: { kind: 'scratch' },
        scratch: {
          starterId: 'vite',
          dirty: false,
          editedAt: '2026-07-16T12:00:00.000Z',
        },
        projects: [],
      },
    });
    await raw.ready;

    const definition = definePlaygroundProject(
      {
        kind: 'vite',
        id: 'scratch',
        starterId: 'vite',
        templateId: 'vite',
        files: { '/index.html': '<main>Companion</main>' },
        firstMaterialization: { kind: 'install' },
        port: 4173,
      },
      playgroundUrlContext,
    );
    const initialEnv = { PATH: '/bin', RIFTY_OWNER_TOKEN: 'opaque-guest-data' };
    const initialTerminalState = { cwd: '/src', env: initialEnv };
    const opening = companion.openProject(definition, { initialTerminalState });
    initialTerminalState.cwd = '/mutated-after-admission';
    initialEnv.PATH = '/mutated-after-admission';
    const openRequest = sentPlaygroundOf(worker, 'workbench:playground-open-project')[0];
    if (openRequest === undefined) throw new Error('missing Playground open request');
    expect(openRequest).toMatchObject({
      initialTerminalState: {
        cwd: '/src',
        env: { PATH: '/bin', RIFTY_OWNER_TOKEN: 'opaque-guest-data' },
      },
    });
    expect(sentOf(worker, 'workbench:open-project')).toEqual([]);

    const snapshotId = `sha256:${'a'.repeat(64)}`;
    worker.emit('message', {
      type: 'workbench:playground-project-opened',
      opId: openRequest.opId,
      projectToken: 'playground-owner-token',
      projectRoot: '/owner-born/playground/scratch',
      acquisition: {
        kind: 'install',
        snapshotFailures: [{ snapshotId, reason: 'snapshot unavailable' }],
      },
      runtime: { kind: 'vite', port: 4321 },
      initialScmSnapshot: { history: [], changes: [] },
      initialTerminalState: {
        cwd: '/src',
        env: { PATH: '/bin', RIFTY_OWNER_TOKEN: 'opaque-guest-data' },
      },
    });
    await acceptProjectSnapshot(
      worker,
      'playground-owner-token',
      '/owner-born/playground/scratch',
      [],
    );
    const project = await opening;
    const openPty = sentOf(worker, 'workbench:project-pty').find(
      (message) => message.frame.type === 'pty:open',
    );
    if (openPty?.frame.type !== 'pty:open') throw new Error('missing Playground PTY open');
    expect(openPty.frame).toMatchObject({
      cwd: '/owner-born/playground/scratch/src',
      env: { PATH: '/bin', RIFTY_OWNER_TOKEN: 'opaque-guest-data' },
    });
    const extra = project.terminals.open();
    const openPtys = sentOf(worker, 'workbench:project-pty').filter(
      (message) => message.frame.type === 'pty:open',
    );
    expect(openPtys).toHaveLength(2);
    expect(openPtys[1]?.frame).toMatchObject({
      cwd: '/owner-born/playground/scratch/src',
      env: { PATH: '/bin', RIFTY_OWNER_TOKEN: 'opaque-guest-data' },
    });
    expect(extra.snapshot()).toEqual({
      cwd: '/src',
      env: { PATH: '/bin', RIFTY_OWNER_TOKEN: 'opaque-guest-data' },
    });
    worker.emit('message', {
      type: 'workbench:project-pty',
      projectToken: 'playground-owner-token',
      frame: { type: 'pty:ready', sid: openPty.frame.sid },
    });

    const run = project.run();
    expect(run.terminal.snapshot()).toEqual({
      cwd: '/src',
      env: { PATH: '/bin', RIFTY_OWNER_TOKEN: 'opaque-guest-data' },
    });
    await settleMicrotasks();
    const exec = sentOf(worker, 'workbench:project-pty').find(
      (message) => message.frame.type === 'pty:exec',
    );
    if (exec?.frame.type !== 'pty:exec') throw new Error('missing Playground runtime exec');
    expect(exec.frame.line).toBe(
      `echo '${snapshotId}: snapshot unavailable' && npm --prefix .. install && vite .. --port 4321`,
    );
    worker.emit('message', {
      type: 'workbench:project-pty',
      projectToken: 'playground-owner-token',
      frame: { type: 'pty:run-ready', sid: exec.frame.sid, rid: exec.frame.rid },
    });
    worker.emit('message', {
      type: 'workbench:project-pty',
      projectToken: 'playground-owner-token',
      frame: {
        type: 'pty:exit',
        sid: exec.frame.sid,
        rid: exec.frame.rid,
        code: 0,
        exit: { code: 0, signal: null },
        cwd: '/owner-born/playground/scratch/src/after',
        env: { AFTER: 'run' },
      },
    });
    await expect(run.exited.then(() => run.terminal.snapshot())).resolves.toEqual({
      cwd: '/src/after',
      env: { AFTER: 'run' },
    });

    const lifecycle = companion.sessionTools(project);
    expect(companion.sessionTools(project)).toBe(lifecycle);
    expect(() => companion.sessionTools({ ...project })).toThrow(TypeError);
    expect(lifecycle.tools.scm.snapshot()).toEqual({ history: [], changes: [] });
    const previewSnapshots: unknown[] = [];
    lifecycle.tools.previews.subscribe((snapshot) => previewSnapshots.push(snapshot));
    worker.emit('message', {
      type: 'workbench:project-preview',
      projectToken: 'playground-owner-token',
      frame: {
        type: 'pty:preview',
        ports: [
          {
            port: 4100,
            url: '/preview/4100/',
            label: 'node api :4100',
            source: 'node',
            sid: 'node-api',
            previewScope: 'scope-api',
          },
          {
            port: 4200,
            url: '/preview/4200/',
            label: 'vite preview',
            source: 'preview',
            sid: 'preview',
            previewScope: 'scope-preview',
          },
        ],
      },
    });
    await settleMicrotasks();
    expect(lifecycle.tools.previews.snapshot()).toEqual([]);
    expect(deps.mountPreview).toHaveBeenCalledTimes(2);
    expect(serviceWorker.controller.messages).toHaveLength(1);
    serviceWorker.pong(0);
    await vi.waitFor(() => expect(lifecycle.tools.previews.snapshot()).toHaveLength(2));
    expect(lifecycle.tools.previews.snapshot()).toEqual([
      { port: 4100, url: '/preview/4100/', label: 'node api :4100', source: 'node' },
      { port: 4200, url: '/preview/4200/', label: 'vite preview', source: 'preview' },
    ]);
    expect(Reflect.ownKeys(lifecycle.tools.previews.snapshot()[0] ?? {})).toEqual([
      'port',
      'url',
      'label',
      'source',
    ]);
    expect(previewSnapshots).toHaveLength(2);
    const refreshing = lifecycle.tools.scm.refresh();
    const toolsRequest = sentPlaygroundOf(worker, 'workbench:playground-project-tools').at(-1);
    if (
      toolsRequest === undefined ||
      toolsRequest.frame.type !== 'workbench:playground-session-tools-request'
    ) {
      throw new Error('missing Playground session-tools request');
    }
    expect(toolsRequest.projectToken).toBe('playground-owner-token');
    worker.emit('message', {
      type: 'workbench:playground-project-tools',
      projectToken: 'playground-owner-token',
      frame: {
        type: 'workbench:playground-session-tools-response',
        requestId: toolsRequest.frame.requestId,
        response: {
          ok: true,
          result: {
            type: 'scm:snapshot',
            snapshot: {
              branch: 'main',
              history: [],
              changes: [{ path: '/index.html', code: ' M', area: 'working' }],
            },
          },
        },
      },
    });
    await expect(refreshing).resolves.toEqual({
      branch: 'main',
      history: [],
      changes: [{ path: '/index.html', code: ' M', area: 'working' }],
    });

    worker.emit('message', {
      type: 'workbench:playground-project-tools',
      projectToken: 'retired-playground-token',
      frame: {
        type: 'workbench:playground-session-tools-scm-snapshot',
        snapshot: { history: [], changes: [] },
      },
    });
    expect(worker.killedWith).toBe('SIGTERM');
    await expect(raw.closed).rejects.toThrow('session tools data for a retired project');
  });

  it('falls a stale companion cwd back to the exact project root without dropping env', async () => {
    const worker = new FakeOwnerWorker();
    const raw = startBrowserWorkspaceOwner(companionInput, dependencies(worker));
    const companion = raw.playground;
    if (companion === undefined) throw new Error('missing Playground companion handle');
    worker.emit('message', {
      type: 'workbench:owner-ready',
      storage: { policy: 'ephemeral', backend: 'memory', durability: 'ephemeral' },
    });
    worker.emit('message', {
      type: 'workbench:playground-ready',
      catalog: {
        active: { kind: 'scratch' },
        scratch: {
          starterId: 'vite',
          dirty: false,
          editedAt: '2026-07-16T12:00:00.000Z',
        },
        projects: [],
      },
    });
    await raw.ready;
    const definition = definePlaygroundProject(
      {
        kind: 'vite',
        id: 'scratch',
        starterId: 'vite',
        templateId: 'vite',
        files: { '/index.html': '<main>Companion</main>' },
        firstMaterialization: { kind: 'install' },
        port: 4173,
      },
      playgroundUrlContext,
    );

    const opening = companion.openProject(definition, {
      initialTerminalState: { cwd: '/deleted', env: { KEEP: 'yes' } },
    });
    const openRequest = sentPlaygroundOf(worker, 'workbench:playground-open-project')[0];
    if (openRequest === undefined) throw new Error('missing Playground open request');
    expect(openRequest).toMatchObject({
      initialTerminalState: { cwd: '/deleted', env: { KEEP: 'yes' } },
    });
    worker.emit('message', {
      type: 'workbench:playground-project-opened',
      opId: openRequest.opId,
      projectToken: 'playground-stale-token',
      projectRoot: '/owner-born/playground/scratch',
      acquisition: { kind: 'install', snapshotFailures: [] },
      runtime: { kind: 'vite', port: 4173 },
      initialScmSnapshot: { history: [], changes: [] },
      initialTerminalState: { cwd: '/', env: { KEEP: 'yes' } },
    });
    await acceptProjectSnapshot(
      worker,
      'playground-stale-token',
      '/owner-born/playground/scratch',
      [
        {
          path: '/owner-born/playground/scratch/deleted',
          kind: 'dir',
          size: 0,
          version: 'misleading-page-snapshot',
        },
      ],
    );
    const project = await opening;
    const openPty = sentOf(worker, 'workbench:project-pty').find(
      (message) => message.frame.type === 'pty:open',
    );
    if (openPty?.frame.type !== 'pty:open') throw new Error('missing Playground PTY open');
    expect(openPty.frame).toMatchObject({
      cwd: '/owner-born/playground/scratch',
      env: { KEEP: 'yes' },
    });
    expect(project.run().terminal.snapshot()).toEqual({ cwd: '/', env: { KEEP: 'yes' } });

    raw.close();
    worker.emit('exit', 0, null);
    await raw.closed;
  });

  it('uses owner-born root and token for PTY lifecycle, then awaits physical shutdown', async () => {
    const worker = new FakeOwnerWorker();
    const deps = dependencies(worker);
    const raw = startBrowserWorkspaceOwner(input, deps);

    expect(worker.sent).toEqual([
      expect.objectContaining({
        type: 'workbench:initialize',
        config: expect.objectContaining({ storage: { persistence: 'ephemeral' } }),
      }),
    ]);
    worker.emit('message', {
      type: 'workbench:owner-ready',
      storage: { policy: 'ephemeral', backend: 'memory', durability: 'ephemeral' },
    });
    await raw.ready;
    expect(raw.storageSnapshot()).toEqual({
      policy: 'ephemeral',
      backend: 'memory',
      durability: 'ephemeral',
    });

    const definition = inspectProjectDefinition(
      projects.vite({ id: 'project-a', files: { '/index.html': '<h1>A</h1>' } }),
    );
    const opening = raw.openProject(definition);
    let openingSettled = false;
    void opening.then(() => {
      openingSettled = true;
    });
    const openRequest = sentOf(worker, 'workbench:open-project')[0];
    if (openRequest === undefined) throw new Error('missing open request');
    worker.emit('message', {
      type: 'workbench:project-opened',
      opId: openRequest.opId,
      projectToken: 'owner-token-a',
      projectRoot: '/owner-born/project-a',
    });
    await settleMicrotasks();
    expect(openingSettled).toBe(false);
    expect(
      sentOf(worker, 'workbench:project-pty').some((message) => message.frame.type === 'pty:open'),
    ).toBe(false);
    await acceptProjectSnapshot(worker, 'owner-token-a', '/owner-born/project-a');

    const project = await opening;
    const openPty = sentOf(worker, 'workbench:project-pty').find(
      (message) => message.frame.type === 'pty:open',
    );
    expect(openPty).toEqual({
      type: 'workbench:project-pty',
      projectToken: 'owner-token-a',
      frame: {
        type: 'pty:open',
        sid: 'workbench-terminal-1',
        cwd: '/owner-born/project-a',
      },
    });
    worker.emit('message', {
      type: 'workbench:project-pty',
      projectToken: 'owner-token-a',
      frame: { type: 'pty:ready', sid: 'workbench-terminal-1' },
    });

    const closing = project.close();
    const closePty = sentOf(worker, 'workbench:project-pty').find(
      (message) => message.frame.type === 'pty:close',
    );
    const closeProject = sentOf(worker, 'workbench:close-project')[0];
    if (closePty?.frame.type !== 'pty:close' || closeProject === undefined) {
      throw new Error('missing project close frames');
    }
    expect(worker.sent.indexOf(closePty)).toBeLessThan(worker.sent.indexOf(closeProject));
    worker.emit('message', {
      type: 'workbench:project-pty',
      projectToken: 'owner-token-a',
      frame: {
        type: 'pty:close-ack',
        sid: closePty.frame.sid,
        opId: closePty.frame.opId,
        ok: true,
      },
    });
    worker.emit('message', {
      type: 'workbench:project-closed',
      opId: closeProject.opId,
      projectToken: 'owner-token-a',
    });
    await closing;
    expect(deps.timers.setTimeout).not.toHaveBeenCalled();

    expect(() => project.terminals.open()).toThrowError(
      expect.objectContaining({ name: 'ClosedHandleError' }),
    );
    raw.close();
    expect(worker.sent.at(-1)).toEqual({ type: 'workbench:shutdown' });
    worker.emit('exit', 0, null);
    await raw.closed;
    expect(worker.killedWith).toBeNull();
  });

  it('disconnects a lost admitted write after close-project ACK instead of waiting for timeout', async () => {
    const worker = new FakeOwnerWorker();
    const raw = startBrowserWorkspaceOwner(input, dependencies(worker));
    worker.emit('message', {
      type: 'workbench:owner-ready',
      storage: { policy: 'ephemeral', backend: 'memory', durability: 'ephemeral' },
    });
    await raw.ready;

    const root = '/owner-born/project-a';
    const opening = raw.openProject(
      inspectProjectDefinition(
        projects.vite({ id: 'project-a', files: { '/src/main.ts': 'initial' } }),
      ),
    );
    const openRequest = sentOf(worker, 'workbench:open-project')[0];
    if (openRequest === undefined) throw new Error('missing open request');
    await acceptOpenedProject(worker, openRequest, 'owner-token-a', root, [
      { path: `${root}/src`, kind: 'dir', size: 0, version: 'dir-v1' },
      {
        path: `${root}/src/main.ts`,
        kind: 'file',
        size: 7,
        content: encoder.encode('initial'),
        version: 'file-v1',
      },
    ]);
    const project = await opening;
    const openPty = sentOf(worker, 'workbench:project-pty').find(
      (message) => message.frame.type === 'pty:open',
    );
    if (openPty?.frame.type !== 'pty:open') throw new Error('missing PTY open');
    worker.emit('message', {
      type: 'workbench:project-pty',
      projectToken: 'owner-token-a',
      frame: { type: 'pty:ready', sid: openPty.frame.sid },
    });

    const expectedVersion = project.files
      .snapshot()
      .entries.find((entry) => entry.path === '/src/main.ts')?.version;
    if (expectedVersion === undefined) throw new Error('initial file version missing');
    const writing = project.files.writeFile('/src/main.ts', encoder.encode('next'), {
      expectedVersion,
    });
    const commit = sentOf(worker, 'workbench:project-vfs').find(
      (message) => message.frame.type === 'rifty:owner-vfs-commit',
    );
    expect(commit?.frame.type).toBe('rifty:owner-vfs-commit');

    const closing = project.close();
    await settleMicrotasks();
    const closePty = sentOf(worker, 'workbench:project-pty').find(
      (message) => message.frame.type === 'pty:close',
    );
    const closeProject = sentOf(worker, 'workbench:close-project')[0];
    expect(closePty?.frame.type).toBe('pty:close');
    expect(closeProject).toBeDefined();
    if (closePty?.frame.type !== 'pty:close' || closeProject === undefined) {
      throw new Error('missing project close frames');
    }
    expect(worker.sent.indexOf(closePty)).toBeLessThan(worker.sent.indexOf(closeProject));

    worker.emit('message', {
      type: 'workbench:project-pty',
      projectToken: 'owner-token-a',
      frame: {
        type: 'pty:close-ack',
        sid: closePty.frame.sid,
        opId: closePty.frame.opId,
        ok: true,
      },
    });
    worker.emit('message', {
      type: 'workbench:project-closed',
      opId: closeProject.opId,
      projectToken: 'owner-token-a',
    });
    await expect(writing).rejects.toBeInstanceOf(ProjectFileOperationError);
    await expect(closing).resolves.toBeUndefined();

    raw.close();
    worker.emit('exit', 0, null);
    await raw.closed;
  });

  it('keeps the project token and real files usable after dirty close preflight rejects', async () => {
    const worker = new FakeOwnerWorker();
    const raw = startBrowserWorkspaceOwner(input, dependencies(worker));
    worker.emit('message', {
      type: 'workbench:owner-ready',
      storage: { policy: 'ephemeral', backend: 'memory', durability: 'ephemeral' },
    });
    await raw.ready;

    const root = '/owner-born/project-a';
    const ownerEpoch = 'epoch:owner-token-a';
    const bytes = encoder.encode('initial');
    const opening = raw.openProject(
      inspectProjectDefinition(
        projects.vite({ id: 'project-a', files: { '/src/main.ts': 'initial' } }),
      ),
    );
    const openRequest = sentOf(worker, 'workbench:open-project')[0];
    if (openRequest === undefined) throw new Error('missing open request');
    await acceptOpenedProject(worker, openRequest, 'owner-token-a', root, [
      { path: `${root}/src`, kind: 'dir', size: 0, version: 'dir-v1' },
      {
        path: `${root}/src/main.ts`,
        kind: 'file',
        size: bytes.byteLength,
        content: bytes,
        version: 'file-v1',
      },
    ]);
    const project = await opening;
    const openPty = sentOf(worker, 'workbench:project-pty').find(
      (message) => message.frame.type === 'pty:open',
    );
    if (openPty?.frame.type !== 'pty:open') throw new Error('missing PTY open');
    worker.emit('message', {
      type: 'workbench:project-pty',
      projectToken: 'owner-token-a',
      frame: { type: 'pty:ready', sid: openPty.frame.sid },
    });

    const openingDocument = project.documents.open('/src/main.ts');
    const documentRead = sentOf(worker, 'workbench:project-vfs').find(
      (message) => message.frame.type === 'workbench:project-vfs-read-file',
    );
    if (documentRead?.frame.type !== 'workbench:project-vfs-read-file') {
      throw new Error('missing document read');
    }
    worker.emit('message', {
      type: 'workbench:project-vfs',
      projectToken: 'owner-token-a',
      frame: {
        type: 'workbench:project-vfs-read-file-result',
        requestId: documentRead.frame.requestId,
        ok: true,
        ownerEpoch,
        treeRevision: 1,
        entry: {
          path: `${root}/src/main.ts`,
          kind: 'file',
          size: bytes.byteLength,
          content: bytes,
          version: 'file-v1',
        },
      },
    });
    const document = await openingDocument;
    const publicVersion = document.snapshot().version;
    if (publicVersion === null) throw new Error('document version missing');
    expect(publicVersion).not.toBe('file-v1');
    expect(publicVersion).not.toContain(ownerEpoch);
    document.replace('dirty');

    const dirtyClose = project.close();
    await expect(dirtyClose).rejects.toBeInstanceOf(DirtyProjectDocumentError);
    expect(sentOf(worker, 'workbench:close-project')).toEqual([]);
    expect(
      sentOf(worker, 'workbench:project-pty').some((message) => message.frame.type === 'pty:close'),
    ).toBe(false);

    const reading = project.files.readFile('/src/main.ts');
    const fileReads = sentOf(worker, 'workbench:project-vfs').filter(
      (message) => message.frame.type === 'workbench:project-vfs-read-file',
    );
    const fileRead = fileReads.at(-1);
    if (fileRead?.frame.type !== 'workbench:project-vfs-read-file') {
      throw new Error('missing post-preflight file read');
    }
    worker.emit('message', {
      type: 'workbench:project-vfs',
      projectToken: 'owner-token-a',
      frame: {
        type: 'workbench:project-vfs-read-file-result',
        requestId: fileRead.frame.requestId,
        ok: true,
        ownerEpoch,
        treeRevision: 1,
        entry: {
          path: `${root}/src/main.ts`,
          kind: 'file',
          size: bytes.byteLength,
          content: bytes,
          version: 'file-v1',
        },
      },
    });
    await expect(reading).resolves.toEqual({
      path: '/src/main.ts',
      bytes,
      version: publicVersion,
    });

    await document.close({ dirty: 'discard' });
    const closing = project.close();
    const closePty = sentOf(worker, 'workbench:project-pty').find(
      (message) => message.frame.type === 'pty:close',
    );
    const closeProject = sentOf(worker, 'workbench:close-project')[0];
    if (closePty?.frame.type !== 'pty:close' || closeProject === undefined) {
      throw new Error('missing retry close frames');
    }
    expect(worker.sent.indexOf(closePty)).toBeLessThan(worker.sent.indexOf(closeProject));
    worker.emit('message', {
      type: 'workbench:project-pty',
      projectToken: 'owner-token-a',
      frame: {
        type: 'pty:close-ack',
        sid: closePty.frame.sid,
        opId: closePty.frame.opId,
        ok: true,
      },
    });
    worker.emit('message', {
      type: 'workbench:project-closed',
      opId: closeProject.opId,
      projectToken: 'owner-token-a',
    });
    await closing;

    raw.close();
    worker.emit('exit', 0, null);
    await raw.closed;
  });

  it('fails the owner and clears content when VFS data crosses a retired token', async () => {
    const worker = new FakeOwnerWorker();
    const raw = startBrowserWorkspaceOwner(input, dependencies(worker));
    worker.emit('message', {
      type: 'workbench:owner-ready',
      storage: { policy: 'ephemeral', backend: 'memory', durability: 'ephemeral' },
    });
    await raw.ready;

    const root = '/owner-born/project-a';
    const opening = raw.openProject(
      inspectProjectDefinition(projects.vite({ id: 'project-a', files: { '/index.html': 'A' } })),
    );
    const openRequest = sentOf(worker, 'workbench:open-project')[0];
    if (openRequest === undefined) throw new Error('missing open request');
    await acceptOpenedProject(worker, openRequest, 'owner-token-a', root, [
      {
        path: `${root}/index.html`,
        kind: 'file',
        size: 1,
        content: encoder.encode('A'),
        version: 'file-v1',
      },
    ]);
    const project = await opening;
    expect(project.files.snapshot().entries).toHaveLength(1);

    worker.emit('message', {
      type: 'workbench:project-vfs',
      projectToken: 'retired-token',
      frame: {
        type: 'workbench:project-vfs-snapshot',
        frame: {
          type: 'snapshot',
          root,
          ownerEpoch: 'retired-owner',
          treeRevision: 2,
          entries: [],
          nodeModulesPresent: false,
        },
      },
    });

    expect(worker.killedWith).toBe('SIGTERM');
    expect(project.files.snapshot().entries).toEqual([]);
    await expect(raw.closed).rejects.toThrow('VFS data for a retired project');
  });

  it('observable-order fault: close fences a mounted route even when teardown throws after GOODBYE', async () => {
    const worker = new FakeOwnerWorker();
    const serviceWorker = new ControlledServiceWorkerContainer();
    const routeEvents: string[] = [];
    const teardownFailure = new Error('preview teardown failed after GOODBYE');
    const deps = {
      ...dependencies(worker),
      serviceWorker,
      mountPreview: vi.fn(() => () => {
        routeEvents.push('goodbye-enqueued');
        throw teardownFailure;
      }),
    };
    const raw = startBrowserWorkspaceOwner(input, deps);
    worker.emit('message', {
      type: 'workbench:owner-ready',
      storage: { policy: 'ephemeral', backend: 'memory', durability: 'ephemeral' },
    });
    await raw.ready;

    const opening = raw.openProject(
      inspectProjectDefinition(
        projects.vite({ id: 'project-a', files: { '/index.html': '<h1>A</h1>' } }),
      ),
    );
    const openRequest = sentOf(worker, 'workbench:open-project')[0];
    if (openRequest === undefined) throw new Error('missing open request');
    await acceptOpenedProject(worker, openRequest, 'owner-token-a', '/owner-born/project-a');
    const project = await opening;
    const openPty = sentOf(worker, 'workbench:project-pty').find(
      (message) => message.frame.type === 'pty:open',
    );
    if (openPty?.frame.type !== 'pty:open') throw new Error('missing PTY open');
    worker.emit('message', {
      type: 'workbench:project-pty',
      projectToken: 'owner-token-a',
      frame: { type: 'pty:ready', sid: openPty.frame.sid },
    });

    const run = project.run();
    await settleMicrotasks();
    const exec = sentOf(worker, 'workbench:project-pty').find(
      (message) => message.frame.type === 'pty:exec',
    );
    if (exec?.frame.type !== 'pty:exec') throw new Error('missing Vite exec');
    worker.emit('message', {
      type: 'workbench:project-pty',
      projectToken: 'owner-token-a',
      frame: { type: 'pty:run-ready', sid: exec.frame.sid, rid: exec.frame.rid },
    });
    await settleMicrotasks();
    worker.emit('message', {
      type: 'workbench:project-preview',
      projectToken: 'owner-token-a',
      frame: {
        type: 'pty:preview',
        ports: [
          {
            port: 5173,
            url: '/preview/5173/',
            label: 'vite :5173',
            source: 'node',
            sid: 'vite-child',
            ptySid: exec.frame.sid,
            ptyRid: exec.frame.rid,
            previewScope: 'scope-a',
          },
        ],
      },
    });
    await settleMicrotasks();
    expect(serviceWorker.controller.messages).toHaveLength(1);
    serviceWorker.pong(0);
    await expect(run.ready).resolves.toEqual({
      port: 5173,
      url: '/preview/5173/',
    });

    const closing = project.close();
    expect(project.close()).toBe(closing);
    await settleMicrotasks();
    const closePty = sentOf(worker, 'workbench:project-pty').find(
      (message) => message.frame.type === 'pty:close',
    );
    const closeProject = sentOf(worker, 'workbench:close-project')[0];
    if (closePty?.frame.type !== 'pty:close' || closeProject === undefined) {
      throw new Error('missing project teardown frames');
    }
    worker.emit('message', {
      type: 'workbench:project-pty',
      projectToken: 'owner-token-a',
      frame: {
        type: 'pty:exit',
        sid: exec.frame.sid,
        rid: exec.frame.rid,
        code: 130,
        exit: { code: null, signal: 'SIGINT' },
        cwd: '/owner-born/project-a',
        env: {},
      },
    });
    worker.emit('message', {
      type: 'workbench:project-pty',
      projectToken: 'owner-token-a',
      frame: {
        type: 'pty:close-ack',
        sid: closePty.frame.sid,
        opId: closePty.frame.opId,
        ok: true,
      },
    });
    worker.emit('message', {
      type: 'workbench:project-closed',
      opId: closeProject.opId,
      projectToken: 'owner-token-a',
    });
    await settleMicrotasks();

    let closeSettled = false;
    void closing
      .finally(() => {
        closeSettled = true;
      })
      .catch(() => {});
    await settleMicrotasks();
    expect(routeEvents).toEqual(['goodbye-enqueued']);
    expect(serviceWorker.controller.messages).toHaveLength(2);
    expect(closeSettled).toBe(false);

    serviceWorker.pong(0);
    await settleMicrotasks();
    expect(closeSettled).toBe(false);

    serviceWorker.pong(1);
    const closeFailure = await closing.catch((error: unknown) => error);
    expect(closeFailure).toBeInstanceOf(AggregateError);
    expect((closeFailure as AggregateError).errors).toEqual([teardownFailure]);
    expect(closeSettled).toBe(true);

    raw.close();
    worker.emit('exit', 0, null);
    await raw.closed;
  });

  it('reconstructs a project definition mismatch across the owner boundary', async () => {
    const worker = new FakeOwnerWorker();
    const raw = startBrowserWorkspaceOwner(input, dependencies(worker));
    worker.emit('message', {
      type: 'workbench:owner-ready',
      storage: { policy: 'ephemeral', backend: 'memory', durability: 'ephemeral' },
    });
    await raw.ready;

    const definition = inspectProjectDefinition(
      projects.vite({ id: 'project-a', files: { '/index.html': '<h1>A</h1>' } }),
    );
    const opening = raw.openProject(definition);
    const openRequest = sentOf(worker, 'workbench:open-project')[0];
    if (openRequest === undefined) throw new Error('missing open request');
    worker.emit('message', {
      type: 'workbench:failure',
      opId: openRequest.opId,
      error: {
        name: 'ProjectDefinitionMismatchError',
        message: 'ProjectDefinitionMismatchError: project "project-a" has a different definition',
      },
    });

    await expect(opening).rejects.toBeInstanceOf(ProjectDefinitionMismatchError);
    raw.close();
    worker.emit('exit', 0, null);
    await raw.closed;
  });

  it('dispatches finite Node definitions to their exact browser runtimes', async () => {
    const files = { '/src/main.mjs': 'console.log("node");\n' };
    const cases = [
      {
        definition: inspectProjectDefinition(
          defineNodeServerProject({
            id: 'browser-node-server',
            files,
            entryPath: '/src/main.mjs',
            port: 4321,
          }),
        ),
        line: 'npm run dev',
        ready: false,
      },
      {
        definition: inspectProjectDefinition(
          defineNodeCliProject({
            id: 'browser-node-cli',
            files,
            entryPath: '/src/main.mjs',
            args: ['two words'],
          }),
        ),
        line: "node ./src/main.mjs 'two words'",
        ready: true,
      },
    ] as const;

    for (const [index, fixture] of cases.entries()) {
      const worker = new FakeOwnerWorker();
      const raw = startBrowserWorkspaceOwner(input, dependencies(worker));
      worker.emit('message', {
        type: 'workbench:owner-ready',
        storage: { policy: 'ephemeral', backend: 'memory', durability: 'ephemeral' },
      });
      await raw.ready;

      const opening = raw.openProject<unknown>(fixture.definition);
      const openRequest = sentOf(worker, 'workbench:open-project')[0];
      if (openRequest === undefined) throw new Error('missing Node open request');
      const projectToken = `owner-token-node-${String(index)}`;
      await acceptOpenedProject(
        worker,
        openRequest,
        projectToken,
        `/owner-born/node-${String(index)}`,
      );
      const project = await opening;
      const openPty = sentOf(worker, 'workbench:project-pty').find(
        (message) => message.frame.type === 'pty:open',
      );
      if (openPty?.frame.type !== 'pty:open') throw new Error('missing Node PTY open');
      worker.emit('message', {
        type: 'workbench:project-pty',
        projectToken,
        frame: { type: 'pty:ready', sid: openPty.frame.sid },
      });

      const run = project.run();
      await settleMicrotasks();
      const exec = sentOf(worker, 'workbench:project-pty').find(
        (message) => message.frame.type === 'pty:exec',
      );
      if (exec?.frame.type !== 'pty:exec') throw new Error('missing Node PTY exec');
      expect(exec.frame.line).toBe(fixture.line);
      worker.emit('message', {
        type: 'workbench:project-pty',
        projectToken,
        frame: { type: 'pty:run-ready', sid: exec.frame.sid, rid: exec.frame.rid },
      });
      if (fixture.ready) await expect(run.ready).resolves.toBeUndefined();

      const closing = project.close();
      await settleMicrotasks();
      const closePty = sentOf(worker, 'workbench:project-pty').find(
        (message) => message.frame.type === 'pty:close',
      );
      const closeProject = sentOf(worker, 'workbench:close-project')[0];
      if (closePty?.frame.type !== 'pty:close' || closeProject === undefined) {
        throw new Error('missing Node close frames');
      }
      worker.emit('message', {
        type: 'workbench:project-pty',
        projectToken,
        frame: {
          type: 'pty:exit',
          sid: exec.frame.sid,
          rid: exec.frame.rid,
          code: 0,
          exit: { code: 0, signal: null },
          cwd: `/owner-born/node-${String(index)}`,
          env: {},
        },
      });
      worker.emit('message', {
        type: 'workbench:project-pty',
        projectToken,
        frame: {
          type: 'pty:close-ack',
          sid: closePty.frame.sid,
          opId: closePty.frame.opId,
          ok: true,
        },
      });
      worker.emit('message', {
        type: 'workbench:project-closed',
        opId: closeProject.opId,
        projectToken,
      });
      await closing;
      raw.close();
      worker.emit('exit', 0, null);
      await raw.closed;
    }
  });
});
