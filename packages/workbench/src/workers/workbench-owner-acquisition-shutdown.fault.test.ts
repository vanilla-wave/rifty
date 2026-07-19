import type { ShadowAssetAdmin } from '@riftydev/npm-client';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it, vi } from 'vitest';
import type { RuntimeAssetProgress } from '../workbench/errors.ts';
import type { PlaygroundOwnerToPageMessage } from '../workbench/internal/playground-owner-protocol.ts';
import {
  definePlaygroundProject,
  playgroundProjectDefinitionWire,
} from '../workbench/internal/playground-project-definition.ts';
import type { WorkbenchOwnerToPageMessage } from '../workbench/owner-protocol.ts';
import {
  inspectProjectDefinition,
  projectDefinitionWire,
  projectStorageSegment,
  projects,
} from '../workbench/project-definition.ts';
import {
  type ProjectAcquisitionEnsureOptions,
  type ProjectAcquisitionPlan,
  type ProjectAcquisitionPort,
  type ProjectAcquisitionRequest,
  type ProjectMaterializationOwner,
  createProjectMaterializer,
} from '../workbench/project-materialization.ts';
import type { ProjectDefinition } from '../workbench/public.ts';
import { createOwnerVfsAuthorityComposition } from './owner-vfs-authority.ts';
import {
  type PlaygroundProjectAuthority,
  createPlaygroundProjectAuthority,
} from './playground-project-authority.ts';
import {
  type WorkbenchOwnerProjectRuntime,
  createWorkbenchOwnerController,
} from './workbench-owner-controller.ts';

const URL_CONTEXT = Object.freeze({
  apiBaseUrl: 'https://playground.invalid/app/',
  clientUrl: 'https://playground.invalid/app/index.html',
});
const ACQUIRED = Object.freeze({
  kind: 'install' as const,
  snapshotFailures: Object.freeze([]),
});
const LATE_PROGRESS = Object.freeze({
  phase: 'ready' as const,
  requiredSetDigest: 'a'.repeat(64),
  assetCount: 1,
  storageClass: 'memory-session' as const,
}) satisfies RuntimeAssetProgress;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error('condition did not become true');
}

async function settledBeforeRelease(promise: Promise<unknown>): Promise<'settled' | 'pending'> {
  return Promise.race([
    promise.then(
      () => 'settled' as const,
      () => 'settled' as const,
    ),
    new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 25)),
  ]);
}

interface AcquisitionCall {
  readonly request: ProjectAcquisitionRequest;
  readonly options: ProjectAcquisitionEnsureOptions | undefined;
}

function sharedAcquisition() {
  const producer = deferred<ProjectAcquisitionPlan>();
  const calls: AcquisitionCall[] = [];
  let released = false;

  const ensure: ProjectAcquisitionPort<ProjectAcquisitionPlan>['ensure'] = (request, options) => {
    calls.push({ request, options });
    return new Promise<ProjectAcquisitionPlan>((resolve, reject) => {
      let settled = false;
      const finish = (result: () => void): void => {
        if (settled) return;
        settled = true;
        options?.signal?.removeEventListener('abort', abort);
        result();
      };
      const abort = (): void => {
        finish(() =>
          reject(options?.signal?.reason ?? new DOMException('Acquisition aborted', 'AbortError')),
        );
      };
      if (options?.signal?.aborted === true) {
        abort();
        return;
      }
      options?.signal?.addEventListener('abort', abort, { once: true });
      void producer.promise.then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error)),
      );
    });
  };

  return {
    port: Object.freeze({ ensure }),
    calls,
    emit(callIndex: number, progress: RuntimeAssetProgress): void {
      calls[callIndex]?.options?.onRuntimeAssetProgress?.(progress);
    },
    release(): void {
      if (released) return;
      released = true;
      producer.resolve(ACQUIRED);
    },
  };
}

function runtimeAssetsAdmin(): ShadowAssetAdmin {
  const empty = Object.freeze({
    storageClass: 'memory-session' as const,
    entryCount: 0,
    storedBytes: 0,
    verifiedObjectCount: 0,
    verifiedObjectBytes: 0,
    readySetCount: 0,
  });
  return Object.freeze({
    inspectUsage: async () => empty,
    clearCache: async () => empty,
  });
}

function runtime(): WorkbenchOwnerProjectRuntime {
  return Object.freeze({
    handleFrame: async () => {},
    close: async () => {},
  });
}

function genericDefinition() {
  return inspectProjectDefinition(
    projects.vite({
      id: 'shutdown-generic',
      files: {
        '/index.html': '<main>shutdown generic</main>',
        '/src/main.ts': 'document.body.dataset.ready = "yes";',
      },
    }),
  );
}

function existingMaterializationOwner(
  definition: ReturnType<typeof genericDefinition>,
): ProjectMaterializationOwner {
  return Object.freeze({
    readProject: async () =>
      Object.freeze({
        definitionIdentity: definition.identity,
        projectRoot: `/.rifty/workbench/v1/projects/${definition.storageSegment}/tree`,
        revision: 7,
      }),
    discardStage: async () => {},
    beginStage: async () => Object.freeze({ stageId: 'unused' }),
    writeStageFile: async () => {},
    promoteStage: async () =>
      Object.freeze({
        projectRoot: `/.rifty/workbench/v1/projects/${definition.storageSegment}/tree`,
        revision: 8,
      }),
    deleteProject: async () => Object.freeze({ revision: 9 }),
    waitForDurability: async () => {},
  });
}

function companionDefinition(): ProjectDefinition<unknown> {
  return definePlaygroundProject(
    {
      kind: 'vite',
      id: 'scratch',
      starterId: 'starter-shutdown',
      templateId: 'vite-shutdown-v1',
      files: {
        '/index.html': '<main>shutdown companion</main>\n',
        '/package.json': '{"scripts":{"dev":"vite"}}\n',
        '/src/main.ts': 'document.body.dataset.ready = "yes";\n',
      },
      port: 5173,
      firstMaterialization: { kind: 'install' },
    },
    URL_CONTEXT,
  );
}

interface PlaygroundHarness {
  readonly fs: MemoryFsSync;
  readonly definition: ProjectDefinition<unknown>;
  readonly owner: PlaygroundProjectAuthority;
  readonly acquisition: ReturnType<typeof sharedAcquisition>;
}

let authoritySequence = 0;

async function playgroundHarness(): Promise<PlaygroundHarness> {
  const fs = new MemoryFsSync();
  const acquisition = sharedAcquisition();
  const composition = createOwnerVfsAuthorityComposition(fs, {
    ownerEpoch: `acquisition-shutdown-${String(++authoritySequence)}`,
    initialRoots: ['/', '/.rifty'],
  });
  let stageSequence = 0;
  const owner = await createPlaygroundProjectAuthority({
    ...composition,
    persistence: 'required',
    now: () => '2026-07-18T12:00:00.000Z',
    createStageId: () => `shutdown-stage-${String(++stageSequence)}`,
    acquisition: acquisition.port,
  });
  const definition = companionDefinition();
  await owner.createScratch({ definition });
  return { fs, definition, owner, acquisition };
}

function treeSnapshot(fs: MemoryFsSync, root: string): Readonly<Record<string, readonly number[]>> {
  const result: Record<string, readonly number[]> = {};
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory)) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory) walk(path);
      else result[path.slice(root.length)] = [...fs.readFileBytesSync(path)];
    }
  };
  walk(root);
  return Object.freeze(result);
}

/** Fault class: observable-order. Shutdown cancellation must precede the lifecycle FIFO join. */
describe('Workbench owner acquisition shutdown faults', () => {
  it('aborts only the generic open waiter before a shared producer is released', async () => {
    const definition = genericDefinition();
    const acquisition = sharedAcquisition();
    const materializer = createProjectMaterializer({
      owner: existingMaterializationOwner(definition),
      acquisition: acquisition.port,
    });
    const sent: WorkbenchOwnerToPageMessage[] = [];
    const createProject = vi.fn(async () => runtime());
    const controller = createWorkbenchOwnerController({
      materializer,
      runtimeAssets: runtimeAssetsAdmin(),
      createProject,
      send: (message) => sent.push(structuredClone(message)),
    });

    const opening = controller.handle({
      type: 'workbench:open-project',
      opId: 'generic-open',
      definition: projectDefinitionWire(definition),
    });
    await waitUntil(() => acquisition.calls.length === 1);
    const openCall = acquisition.calls[0];
    if (openCall === undefined) throw new Error('missing generic acquisition call');
    const otherManagerWaiter = acquisition.port.ensure(openCall.request);
    const shutdown = controller.handle({ type: 'workbench:shutdown' });

    const [openingBeforeRelease, shutdownBeforeRelease, otherBeforeRelease] = await Promise.all([
      settledBeforeRelease(opening),
      settledBeforeRelease(shutdown),
      settledBeforeRelease(otherManagerWaiter),
    ]);
    const openSignal = openCall.options?.signal;
    acquisition.emit(0, LATE_PROGRESS);
    acquisition.release();
    await Promise.all([opening, shutdown, controller.lifetime, otherManagerWaiter]);

    expect(openingBeforeRelease).toBe('settled');
    expect(shutdownBeforeRelease).toBe('settled');
    expect(otherBeforeRelease).toBe('pending');
    expect(openSignal).toBeInstanceOf(AbortSignal);
    expect(openSignal?.aborted).toBe(true);
    expect(acquisition.calls[1]?.options?.signal).toBeUndefined();
    expect(createProject).not.toHaveBeenCalled();
    expect(sent.some((message) => message.type === 'workbench:project-opened')).toBe(false);
    expect(sent.some((message) => message.type === 'workbench:runtime-assets-progress')).toBe(
      false,
    );
  });

  it('aborts a companion authority open before its shared producer is released', async () => {
    const h = await playgroundHarness();
    const coreMessages: WorkbenchOwnerToPageMessage[] = [];
    const companionMessages: PlaygroundOwnerToPageMessage[] = [];
    const createProject = vi.fn(async () => runtime());
    const controller = createWorkbenchOwnerController({
      closeAuthority: () => h.owner.close(),
      runtimeAssets: runtimeAssetsAdmin(),
      createProject,
      send: (message) => coreMessages.push(structuredClone(message)),
      playground: {
        urlContext: URL_CONTEXT,
        authority: h.owner,
        send: (message) => companionMessages.push(structuredClone(message)),
      },
    });

    const opening = controller.handle({
      type: 'workbench:playground-open-project',
      opId: 'companion-open',
      definition: playgroundProjectDefinitionWire(h.definition),
    });
    await waitUntil(() => h.acquisition.calls.length === 1);
    const openCall = h.acquisition.calls[0];
    if (openCall === undefined) throw new Error('missing companion acquisition call');
    const shutdown = controller.handle({ type: 'workbench:shutdown' });

    const [openingBeforeRelease, shutdownBeforeRelease] = await Promise.all([
      settledBeforeRelease(opening),
      settledBeforeRelease(shutdown),
    ]);
    const openSignal = openCall.options?.signal;
    h.acquisition.emit(0, LATE_PROGRESS);
    h.acquisition.release();
    await Promise.all([opening, shutdown, controller.lifetime]);

    expect(openingBeforeRelease).toBe('settled');
    expect(shutdownBeforeRelease).toBe('settled');
    expect(openSignal).toBeInstanceOf(AbortSignal);
    expect(openSignal?.aborted).toBe(true);
    expect(createProject).not.toHaveBeenCalled();
    expect(
      companionMessages.some((message) => message.type === 'workbench:playground-project-opened'),
    ).toBe(false);
    expect(
      coreMessages.some((message) => message.type === 'workbench:runtime-assets-progress'),
    ).toBe(false);
  });

  it('direct authority close aborts open without publishing a live project or changing its tree', async () => {
    const h = await playgroundHarness();
    const projectRoot = `/.rifty/workbench/v1/projects/${projectStorageSegment('scratch')}/tree`;
    const catalogBefore = structuredClone(h.owner.catalogSnapshot());
    const treeBefore = treeSnapshot(h.fs, projectRoot);
    const progress = vi.fn<(value: RuntimeAssetProgress) => void>();
    const opening = h.owner.openProject(h.definition, undefined, {
      onRuntimeAssetProgress: progress,
    });
    const openingOutcome = opening.then(
      (opened) => ({ kind: 'opened' as const, opened }),
      (error: unknown) => ({ kind: 'rejected' as const, error }),
    );
    await waitUntil(() => h.acquisition.calls.length === 1);
    const openCall = h.acquisition.calls[0];
    if (openCall === undefined) throw new Error('missing direct acquisition call');
    const closing = h.owner.close();
    const closingOutcome = closing.then(
      () => ({ kind: 'closed' as const }),
      (error: unknown) => ({ kind: 'rejected' as const, error }),
    );

    const [openingBeforeRelease, closingBeforeRelease] = await Promise.all([
      settledBeforeRelease(openingOutcome),
      settledBeforeRelease(closingOutcome),
    ]);
    const openSignal = openCall.options?.signal;
    h.acquisition.emit(0, LATE_PROGRESS);
    h.acquisition.release();
    const [openedResult, closedResult] = await Promise.all([openingOutcome, closingOutcome]);
    if (openedResult.kind === 'opened') await openedResult.opened.close();

    expect(openingBeforeRelease).toBe('settled');
    expect(closingBeforeRelease).toBe('settled');
    expect(openSignal).toBeInstanceOf(AbortSignal);
    expect(openSignal?.aborted).toBe(true);
    expect(openedResult.kind).toBe('rejected');
    expect(closedResult.kind).toBe('closed');
    expect(progress).not.toHaveBeenCalled();
    expect(h.owner.catalogSnapshot()).toEqual(catalogBefore);
    expect(treeSnapshot(h.fs, projectRoot)).toEqual(treeBefore);
  });
});
