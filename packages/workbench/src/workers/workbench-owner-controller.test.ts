import {
  EMPTY_SHADOW_ASSET_PLAN,
  type InstallTreeResult,
  ShadowAssetError,
  ShadowAssetInstallError,
} from '@riftydev/npm-client';
import { describe, expect, it, vi } from 'vitest';
import {
  RuntimeAssetError,
  deserializeWorkbenchOwnerError,
  runtimeAssetMessage,
} from '../workbench/errors.ts';
import type { PlaygroundOwnerToPageMessage } from '../workbench/internal/playground-owner-protocol.ts';
import {
  definePlaygroundProject,
  playgroundProjectDefinitionWire,
} from '../workbench/internal/playground-project-definition.ts';
import {
  type OwnerProjectToken,
  type WorkbenchOwnerToPageMessage,
  createOwnerProjectToken,
} from '../workbench/owner-protocol.ts';
import {
  inspectProjectDefinition,
  projectDefinitionWire,
  projects,
} from '../workbench/project-definition.ts';
import type {
  ProjectAcquisitionOptions,
  ProjectMaterializer,
} from '../workbench/project-materialization.ts';
import { PackageTreeUnattestedError } from './owner-package-state.ts';
import type { PlaygroundProjectAuthority } from './playground-project-authority.ts';
import {
  type WorkbenchOwnerProjectRuntime,
  type WorkbenchOwnerProjectRuntimeInput,
  createWorkbenchOwnerController,
} from './workbench-owner-controller.ts';
import { workbenchFinalDurabilityError } from './workbench-owner-storage.ts';

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
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error('condition did not become true');
}

async function settledOr(
  promise: Promise<unknown>,
  pending: 'pending',
): Promise<'settled' | 'pending'> {
  return Promise.race([
    promise.then(() => 'settled' as const),
    Promise.resolve().then(() => pending),
  ]);
}

function definitionWire(id = 'project-a') {
  return projectDefinitionWire(
    inspectProjectDefinition(
      projects.vite({
        id,
        files: {
          '/index.html': `<main>${id}</main>`,
          '/src/main.ts': `document.body.dataset.project = ${JSON.stringify(id)}`,
        },
      }),
    ),
  );
}

function runtimeAssetsAdmin() {
  const empty = Object.freeze({
    storageClass: 'memory-session' as const,
    entryCount: 0,
    storedBytes: 0,
    verifiedObjectCount: 0,
    verifiedObjectBytes: 0,
    readySetCount: 0,
  });
  return {
    inspectUsage: vi.fn(async () => empty),
    clearCache: vi.fn(async () => empty),
  };
}

function rawShadowAssetFailure(phase: 'fetch' | 'persist') {
  const privateUrl = 'https://registry.private.test/esbuild/-/esbuild.tgz?token=owner-secret';
  const privateTransport = 'owner transport rejected private URL';
  const privateCause = new Error('owner OPFS path /.rifty/private/object');
  return {
    privateCause,
    privateTransport,
    privateUrl,
    error: new ShadowAssetError({
      message: `${phase} failed at ${privateUrl}`,
      requiredSetDigest: 'a'.repeat(64),
      assetId: 'esbuild-wasm@0.28.0/package/esbuild.wasm',
      phase,
      transports: [{ transport: 'eddy', message: privateTransport }],
      recovery: phase === 'fetch' ? 'retry' : 'clear-and-retry',
      usedBytes: 2048,
      requiredBytes: 4096,
      cause: privateCause,
    }),
  };
}

function rawShadowAssetInstallFailure() {
  const raw = rawShadowAssetFailure('persist');
  const treeResult: InstallTreeResult = {
    packages: [],
    lockfile: {
      name: 'private-project-name',
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: {},
    },
    conflicts: [],
    provenance: { resolution: 'metadata', packages: [] },
  };
  return {
    ...raw,
    error: new ShadowAssetInstallError(treeResult, EMPTY_SHADOW_ASSET_PLAN, {
      message: raw.error.message,
      requiredSetDigest: EMPTY_SHADOW_ASSET_PLAN.requiredSetDigest,
      phase: 'persist',
      transports: [{ transport: 'eddy', message: raw.privateTransport }],
      recovery: 'clear-and-retry',
      usedBytes: 2048,
      requiredBytes: 4096,
      cause: raw.privateCause,
    }),
  };
}

function expectPublicRuntimeAssetFailure(
  message: WorkbenchOwnerToPageMessage | undefined,
  expected: Readonly<{
    phase: 'fetch' | 'persist' | 'ready';
    recovery: 'retry' | 'clear-and-retry';
    requiredSetDigest?: string;
    assetId?: string;
    usedBytes?: number;
    requiredBytes?: number;
  }>,
): void {
  expect(message).toEqual({
    type: 'workbench:failure',
    opId: expect.any(String),
    error: {
      name: 'RuntimeAssetError',
      code: 'ESHADOWASSET',
      message: runtimeAssetMessage(expected.phase),
      phase: expected.phase,
      recovery: expected.recovery,
      ...(expected.requiredSetDigest === undefined
        ? {}
        : { requiredSetDigest: expected.requiredSetDigest }),
      ...(expected.assetId === undefined ? {} : { assetId: expected.assetId }),
      ...(expected.usedBytes === undefined ? {} : { usedBytes: expected.usedBytes }),
      ...(expected.requiredBytes === undefined ? {} : { requiredBytes: expected.requiredBytes }),
    },
  });
  if (message?.type !== 'workbench:failure') throw new Error('expected owner failure');
  const restored = deserializeWorkbenchOwnerError(message.error);
  expect(restored).toBeInstanceOf(RuntimeAssetError);
  expect(restored).toMatchObject(expected);
}

interface RuntimeRecord {
  readonly input: WorkbenchOwnerProjectRuntimeInput;
  readonly runtime: WorkbenchOwnerProjectRuntime & {
    readonly handleFrame: ReturnType<typeof vi.fn>;
    readonly close: ReturnType<typeof vi.fn>;
  };
}

function harness(options: { readonly generateProjectToken?: () => string } = {}) {
  const sent: WorkbenchOwnerToPageMessage[] = [];
  const events: string[] = [];
  const runtimeRecords: RuntimeRecord[] = [];
  let tokenNumber = 0;

  const materializerOpen = vi.fn(
    async (
      definition: Parameters<ProjectMaterializer['open']>[0],
      _options?: ProjectAcquisitionOptions,
    ) => {
      events.push(`materialize:${definition.id}`);
      return Object.freeze({
        projectKey: definition.storageSegment,
        projectRoot: `/.rifty/workbench/v1/projects/${definition.storageSegment}/tree`,
        acquisition: Object.freeze({ provenance: 'registry' }),
      });
    },
  );
  const materializerDelete = vi.fn(async (id: string) => {
    events.push(`delete:${id}`);
  });
  const materializerClose = vi.fn(async () => {
    events.push('materializer-close');
  });
  const cancelActiveAcquisition = vi.fn();
  const materializer: ProjectMaterializer = {
    open: materializerOpen,
    delete: materializerDelete,
    cancelActiveAcquisition,
    close: materializerClose,
  };

  const createProject = vi.fn(async (input: WorkbenchOwnerProjectRuntimeInput) => {
    events.push(`runtime-create:${input.definition.id}`);
    const runtime = {
      handleFrame: vi.fn(async () => {}),
      close: vi.fn(async () => {
        events.push(`runtime-close:${input.definition.id}`);
      }),
    } satisfies WorkbenchOwnerProjectRuntime;
    runtimeRecords.push({ input, runtime });
    return runtime;
  });
  const runtimeAssets = runtimeAssetsAdmin();

  const controller = createWorkbenchOwnerController({
    materializer,
    runtimeAssets,
    createProject,
    generateProjectToken:
      options.generateProjectToken ??
      (() => {
        tokenNumber += 1;
        return `owner-project-${tokenNumber}`;
      }),
    send(message) {
      sent.push(structuredClone(message));
    },
  });

  return {
    controller,
    sent,
    events,
    runtimeRecords,
    materializerOpen,
    materializerDelete,
    materializerClose,
    cancelActiveAcquisition,
    runtimeAssets,
    createProject,
    runtime(index = 0): RuntimeRecord {
      const record = runtimeRecords[index];
      if (record === undefined) throw new Error(`missing runtime ${index}`);
      return record;
    },
    opened(index = 0) {
      const message = sent.filter(
        (
          candidate,
        ): candidate is Extract<
          WorkbenchOwnerToPageMessage,
          { type: 'workbench:project-opened' }
        > => candidate.type === 'workbench:project-opened',
      )[index];
      if (message === undefined) throw new Error(`missing opened reply ${index}`);
      return message;
    },
  };
}

function ptyMessage(projectToken: OwnerProjectToken, sid = 'terminal-1') {
  return {
    type: 'workbench:project-pty' as const,
    projectToken,
    frame: { type: 'pty:open' as const, sid },
  };
}

function previewMessage(projectToken: OwnerProjectToken) {
  return {
    type: 'workbench:project-preview' as const,
    projectToken,
    frame: { type: 'pty:preview-req' as const },
  };
}

function vfsMessage(projectToken: OwnerProjectToken) {
  return {
    type: 'workbench:project-vfs' as const,
    projectToken,
    frame: { type: 'workbench:project-vfs-snapshot-request' as const },
  };
}

describe('Workbench owner controller', () => {
  it('linearizes inspect behind an admitted clear and returns post-clear zeros', async () => {
    const h = harness();
    const clearGate = deferred<void>();
    const empty = await h.runtimeAssets.inspectUsage();
    h.runtimeAssets.inspectUsage.mockClear();
    h.runtimeAssets.clearCache.mockImplementationOnce(async () => {
      h.events.push('assets:clear');
      await clearGate.promise;
      return empty;
    });
    h.runtimeAssets.inspectUsage.mockImplementationOnce(async () => {
      h.events.push('assets:inspect');
      return empty;
    });

    const clearing = h.controller.handle({
      type: 'workbench:runtime-assets-clear',
      opId: 'assets-clear',
    });
    const inspecting = h.controller.handle({
      type: 'workbench:runtime-assets-inspect',
      opId: 'assets-inspect',
    });
    await waitUntil(() => h.runtimeAssets.clearCache.mock.calls.length === 1);
    expect(h.runtimeAssets.inspectUsage).not.toHaveBeenCalled();
    clearGate.resolve(undefined);
    await Promise.all([clearing, inspecting]);

    expect(h.events).toEqual(['assets:clear', 'assets:inspect']);
    expect(h.sent.slice(-2)).toEqual([
      {
        type: 'workbench:runtime-assets-cleared',
        opId: 'assets-clear',
        inspection: empty,
      },
      {
        type: 'workbench:runtime-assets-inspected',
        opId: 'assets-inspect',
        inspection: empty,
      },
    ]);
  });

  it('settles an admitted clear before queued shutdown closes owner authority', async () => {
    const h = harness();
    const clearGate = deferred<void>();
    const empty = await h.runtimeAssets.inspectUsage();
    h.runtimeAssets.clearCache.mockImplementationOnce(async () => {
      h.events.push('assets:clear:start');
      await clearGate.promise;
      h.events.push('assets:clear:end');
      return empty;
    });
    h.materializerClose.mockImplementationOnce(async () => {
      h.events.push('authority:close');
    });

    const clearing = h.controller.handle({
      type: 'workbench:runtime-assets-clear',
      opId: 'assets-clear-before-close',
    });
    await waitUntil(() => h.runtimeAssets.clearCache.mock.calls.length === 1);
    const shutdown = h.controller.handle({ type: 'workbench:shutdown' });
    expect(h.materializerClose).not.toHaveBeenCalled();

    clearGate.resolve(undefined);
    await clearing;
    expect(h.sent).toContainEqual({
      type: 'workbench:runtime-assets-cleared',
      opId: 'assets-clear-before-close',
      inspection: empty,
    });
    await shutdown;
    await h.controller.lifetime;
    expect(h.events).toEqual(['assets:clear:start', 'assets:clear:end', 'authority:close']);
  });

  it('settles an admitted inspect before queued shutdown closes owner authority', async () => {
    const h = harness();
    const inspectGate = deferred<void>();
    const empty = await h.runtimeAssets.inspectUsage();
    h.runtimeAssets.inspectUsage.mockClear();
    h.runtimeAssets.inspectUsage.mockImplementationOnce(async () => {
      h.events.push('assets:inspect:start');
      await inspectGate.promise;
      h.events.push('assets:inspect:end');
      return empty;
    });
    h.materializerClose.mockImplementationOnce(async () => {
      h.events.push('authority:close');
    });

    const inspecting = h.controller.handle({
      type: 'workbench:runtime-assets-inspect',
      opId: 'assets-inspect-before-close',
    });
    await waitUntil(() => h.runtimeAssets.inspectUsage.mock.calls.length === 1);
    const shutdown = h.controller.handle({ type: 'workbench:shutdown' });
    expect(h.materializerClose).not.toHaveBeenCalled();

    inspectGate.resolve(undefined);
    await inspecting;
    expect(h.sent).toContainEqual({
      type: 'workbench:runtime-assets-inspected',
      opId: 'assets-inspect-before-close',
      inspection: empty,
    });
    await shutdown;
    expect(h.events).toEqual(['assets:inspect:start', 'assets:inspect:end', 'authority:close']);
  });

  it('settles clear then inspect before a later queued shutdown', async () => {
    const h = harness();
    const clearGate = deferred<void>();
    const inspectGate = deferred<void>();
    const empty = await h.runtimeAssets.inspectUsage();
    h.runtimeAssets.inspectUsage.mockClear();
    h.runtimeAssets.clearCache.mockImplementationOnce(async () => {
      h.events.push('assets:clear:start');
      await clearGate.promise;
      h.events.push('assets:clear:end');
      return empty;
    });
    h.runtimeAssets.inspectUsage.mockImplementationOnce(async () => {
      h.events.push('assets:inspect:start');
      await inspectGate.promise;
      h.events.push('assets:inspect:end');
      return empty;
    });
    h.materializerClose.mockImplementationOnce(async () => {
      h.events.push('authority:close');
    });

    const clearing = h.controller.handle({
      type: 'workbench:runtime-assets-clear',
      opId: 'assets-clear-before-inspect-close',
    });
    const inspecting = h.controller.handle({
      type: 'workbench:runtime-assets-inspect',
      opId: 'assets-inspect-after-clear-before-close',
    });
    await waitUntil(() => h.runtimeAssets.clearCache.mock.calls.length === 1);
    const shutdown = h.controller.handle({ type: 'workbench:shutdown' });

    clearGate.resolve(undefined);
    await clearing;
    await waitUntil(() => h.runtimeAssets.inspectUsage.mock.calls.length === 1);
    expect(h.materializerClose).not.toHaveBeenCalled();
    inspectGate.resolve(undefined);
    await inspecting;
    await shutdown;

    expect(h.sent.slice(-2)).toEqual([
      {
        type: 'workbench:runtime-assets-cleared',
        opId: 'assets-clear-before-inspect-close',
        inspection: empty,
      },
      {
        type: 'workbench:runtime-assets-inspected',
        opId: 'assets-inspect-after-clear-before-close',
        inspection: empty,
      },
    ]);
    expect(h.events).toEqual([
      'assets:clear:start',
      'assets:clear:end',
      'assets:inspect:start',
      'assets:inspect:end',
      'authority:close',
    ]);
  });

  it('projects a final asset flush failure without its owner-local path or detail', async () => {
    const h = harness();
    const assetPath = '/.rifty/workbench/v1/runtime-assets/v1/objects/private-object';
    const rawDetail = 'permission denied in private OPFS handle';
    const failure = workbenchFinalDurabilityError({
      failures: [{ path: assetPath, op: 'write', message: rawDetail }],
      total: 1,
    });
    if (failure === null) throw new Error('expected final durability failure');
    h.materializerClose.mockRejectedValueOnce(failure);

    const shutdown = h.controller.handle({ type: 'workbench:shutdown' });

    await expect(shutdown).rejects.toBe(failure);
    await expect(h.controller.lifetime).rejects.toBe(failure);
    expect(h.sent).toEqual([
      {
        type: 'workbench:failure',
        error: {
          name: 'RuntimeAssetError',
          code: 'ESHADOWASSET',
          message: 'Runtime asset manager close failed',
          phase: 'close',
          recovery: 'none',
        },
      },
    ]);
    expect(JSON.stringify(h.sent)).not.toContain(assetPath);
    expect(JSON.stringify(h.sent)).not.toContain(rawDetail);
  });

  it('projects a generic-open ShadowAssetError through the exact public prototype', async () => {
    const h = harness();
    const raw = rawShadowAssetFailure('fetch');
    h.materializerOpen.mockRejectedValueOnce(raw.error);

    await h.controller.handle({
      type: 'workbench:open-project',
      opId: 'generic-asset-failure',
      definition: definitionWire(),
    });

    expectPublicRuntimeAssetFailure(h.sent.at(-1), {
      phase: 'fetch',
      recovery: 'retry',
      requiredSetDigest: raw.error.requiredSetDigest,
      assetId: raw.error.assetId,
      usedBytes: 2048,
      requiredBytes: 4096,
    });
    const wire = JSON.stringify(h.sent);
    expect(wire).not.toContain(raw.privateUrl);
    expect(wire).not.toContain(raw.privateTransport);
    expect(wire).not.toContain(raw.privateCause.message);
  });

  it('projects a companion-open ShadowAssetInstallError without its tree or transport evidence', async () => {
    const raw = rawShadowAssetInstallFailure();
    const urlContext = Object.freeze({
      apiBaseUrl: 'https://playground.test/app/',
      clientUrl: 'https://playground.test/app/index.html',
    });
    const definition = definePlaygroundProject(
      {
        kind: 'vite',
        id: 'asset-failure',
        starterId: 'starter-a',
        templateId: 'vite-v1',
        files: { '/package.json': '{"scripts":{"dev":"vite"}}\n' },
        port: 5174,
        firstMaterialization: { kind: 'install' },
      },
      urlContext,
    );
    const coreMessages: WorkbenchOwnerToPageMessage[] = [];
    const companionMessages: PlaygroundOwnerToPageMessage[] = [];
    const authority = {
      openProject: vi.fn(async () => {
        throw raw.error;
      }),
      cancelActiveAcquisition: vi.fn(),
    } as unknown as PlaygroundProjectAuthority;
    const controller = createWorkbenchOwnerController({
      closeAuthority: async () => {},
      runtimeAssets: runtimeAssetsAdmin(),
      createProject: async () => {
        throw new Error('companion runtime must not start after asset failure');
      },
      send: (message) => coreMessages.push(structuredClone(message)),
      playground: {
        urlContext,
        authority,
        send: (message) => companionMessages.push(structuredClone(message)),
      },
    });

    await controller.handle({
      type: 'workbench:playground-open-project',
      opId: 'companion-asset-failure',
      definition: playgroundProjectDefinitionWire(definition),
    });

    expectPublicRuntimeAssetFailure(coreMessages.at(-1), {
      phase: 'persist',
      recovery: 'clear-and-retry',
      requiredSetDigest: raw.error.requiredSetDigest,
      usedBytes: 2048,
      requiredBytes: 4096,
    });
    expect(companionMessages).toEqual([]);
    const wire = JSON.stringify(coreMessages);
    expect(wire).not.toContain('private-project-name');
    expect(wire).not.toContain(raw.privateUrl);
    expect(wire).not.toContain(raw.privateTransport);
    expect(wire).not.toContain(raw.privateCause.message);
  });

  it('projects unattested package-tree identity as safe retryable readiness failure', async () => {
    const h = harness();
    const privateRoot = '/.rifty/workbench/v1/projects/private-owner/tree';
    const privateSlug = 'owner-private-project-slug';
    h.materializerOpen.mockRejectedValueOnce(
      new PackageTreeUnattestedError({ root: privateRoot, slug: privateSlug }),
    );

    await h.controller.handle({
      type: 'workbench:open-project',
      opId: 'generic-unattested-failure',
      definition: definitionWire(),
    });

    expectPublicRuntimeAssetFailure(h.sent.at(-1), {
      phase: 'ready',
      recovery: 'retry',
    });
    const wire = JSON.stringify(h.sent);
    expect(wire).not.toContain(privateRoot);
    expect(wire).not.toContain(privateSlug);
    expect(wire).not.toContain('EUNATTESTEDPACKAGETREE');
  });

  it('routes companion open/catalog through one authority and releases it after runtime teardown', async () => {
    const urlContext = Object.freeze({
      apiBaseUrl: 'https://playground.test/app/',
      clientUrl: 'https://playground.test/app/index.html',
    });
    const definition = definePlaygroundProject(
      {
        kind: 'vite',
        id: 'scratch',
        starterId: 'starter-a',
        templateId: 'vite-v1',
        files: { '/package.json': '{"scripts":{"dev":"vite"}}\n' },
        port: 5174,
        firstMaterialization: { kind: 'install' },
      },
      urlContext,
    );
    const events: string[] = [];
    const release = vi.fn(async () => {
      events.push('authority-release');
    });
    const openedProject = Object.freeze({
      projectKey: 'scratch',
      projectRoot: '/.rifty/workbench/v1/projects/scratch/tree',
      acquisition: Object.freeze({ kind: 'install' as const, snapshotFailures: Object.freeze([]) }),
      initialTerminalState: Object.freeze({
        cwd: '/',
        env: Object.freeze({ PATH: '/bin', RIFTY_OWNER_TOKEN: 'opaque-guest-data' }),
      }),
      close: release,
    });
    const authority = {
      openProject: vi.fn(async () => openedProject),
      recordMutation: vi.fn(async () => {}),
      rename: vi.fn(async () => ({ active: null, scratch: null, projects: [] })),
      cancelActiveAcquisition: vi.fn(),
    } as unknown as PlaygroundProjectAuthority;
    const coreMessages: WorkbenchOwnerToPageMessage[] = [];
    const companionMessages: PlaygroundOwnerToPageMessage[] = [];
    const runtimeClose = vi.fn(async () => {
      events.push('runtime-close');
    });
    const playgroundTools = {
      initialScmSnapshot: Object.freeze({ history: Object.freeze([]), changes: Object.freeze([]) }),
      handle: vi.fn(async () => {}),
    };
    const closeAuthority = vi.fn(async () => {
      events.push('owner-close');
    });
    let createdInput: WorkbenchOwnerProjectRuntimeInput | undefined;
    const createProject = vi.fn(async (input: WorkbenchOwnerProjectRuntimeInput) => {
      createdInput = input;
      return {
        handleFrame: vi.fn(),
        playgroundTools,
        close: runtimeClose,
      };
    });
    const controller = createWorkbenchOwnerController({
      closeAuthority,
      runtimeAssets: runtimeAssetsAdmin(),
      createProject,
      generateProjectToken: () => 'companion-token',
      send: (message) => coreMessages.push(message),
      playground: {
        urlContext,
        authority,
        send: (message) => companionMessages.push(message),
      },
    });

    await controller.handle({
      type: 'workbench:playground-open-project',
      opId: 'open-companion',
      definition: playgroundProjectDefinitionWire(definition),
      initialTerminalState: {
        cwd: '/stale',
        env: { PATH: '/bin', RIFTY_OWNER_TOKEN: 'opaque-guest-data' },
      },
    });
    expect(authority.openProject).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        cwd: '/stale',
        env: { PATH: '/bin', RIFTY_OWNER_TOKEN: 'opaque-guest-data' },
      }),
      { onRuntimeAssetProgress: expect.any(Function) },
    );
    expect(companionMessages).toEqual([
      {
        type: 'workbench:playground-project-opened',
        opId: 'open-companion',
        projectToken: 'companion-token',
        projectRoot: '/.rifty/workbench/v1/projects/scratch/tree',
        acquisition: { kind: 'install', snapshotFailures: [] },
        runtime: { kind: 'vite', port: 5174 },
        initialScmSnapshot: { history: [], changes: [] },
        initialTerminalState: {
          cwd: '/',
          env: { PATH: '/bin', RIFTY_OWNER_TOKEN: 'opaque-guest-data' },
        },
      },
    ]);
    expect(coreMessages).toEqual([]);

    if (createdInput === undefined) throw new Error('Companion project input was not captured');
    if (createdInput.recordMutation === undefined) {
      throw new Error('Companion project mutation recorder was not captured');
    }
    await createdInput.recordMutation('file', 42);
    expect(authority.recordMutation).toHaveBeenCalledWith({
      kind: 'file',
      project: openedProject,
      treeRevision: 42,
    });
    createdInput.emit({
      type: 'playground-tools',
      frame: {
        type: 'workbench:playground-session-tools-scm-snapshot',
        snapshot: { history: [], changes: [] },
      },
    });
    expect(companionMessages.at(-1)).toEqual({
      type: 'workbench:playground-project-tools',
      projectToken: 'companion-token',
      frame: {
        type: 'workbench:playground-session-tools-scm-snapshot',
        snapshot: { history: [], changes: [] },
      },
    });

    await controller.handle({
      type: 'workbench:playground-project-tools',
      projectToken: createOwnerProjectToken(() => 'companion-token'),
      frame: {
        type: 'workbench:playground-session-tools-request',
        requestId: 'refresh-1',
        operation: { type: 'scm:refresh' },
      },
    });
    expect(playgroundTools.handle).toHaveBeenCalledWith({
      type: 'workbench:playground-session-tools-request',
      requestId: 'refresh-1',
      operation: { type: 'scm:refresh' },
    });

    await controller.handle({
      type: 'workbench:close-project',
      opId: 'close-companion',
      projectToken: createOwnerProjectToken(() => 'companion-token'),
    });
    expect(events).toEqual(['runtime-close', 'authority-release']);

    await controller.handle({
      type: 'workbench:playground-catalog',
      opId: 'rename-companion',
      command: { kind: 'rename', id: 'project-a', name: 'Renamed' },
    });
    expect(authority.rename).toHaveBeenCalledWith('project-a', 'Renamed');
    expect(companionMessages.at(-1)).toEqual({
      type: 'workbench:playground-catalog-completed',
      opId: 'rename-companion',
    });

    await controller.handle({ type: 'workbench:shutdown' });
    await controller.lifetime;
    expect(closeAuthority).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toBe('owner-close');
  });

  it('revalidates exact wire bytes at owner ingress and recovers after a failed open', async () => {
    const h = harness();
    const valid = definitionWire();

    await h.controller.handle({
      type: 'workbench:open-project',
      opId: 'open-forged',
      definition: { ...valid, identity: `${valid.identity}:forged` },
    });

    expect(h.materializerOpen).not.toHaveBeenCalled();
    expect(h.sent).toEqual([
      {
        type: 'workbench:failure',
        opId: 'open-forged',
        error: {
          name: 'TypeError',
          message: 'Project definition wire identity does not match exact received bytes',
        },
      },
    ]);

    await h.controller.handle({
      type: 'workbench:open-project',
      opId: 'open-valid',
      definition: valid,
    });

    const opened = h.opened();
    expect(opened).toEqual({
      type: 'workbench:project-opened',
      opId: 'open-valid',
      projectToken: 'owner-project-1',
      projectRoot: '/.rifty/workbench/v1/projects/project-a/tree',
    });
    expect(h.createProject).toHaveBeenCalledTimes(1);
    expect(h.runtime().input.definition.id).toBe('project-a');
    expect(h.runtime().input.materialized).toMatchObject({
      projectKey: 'project-a',
      projectRoot: '/.rifty/workbench/v1/projects/project-a/tree',
    });

    await h.controller.handle({ type: 'workbench:initialize', config: {} });
    expect(h.sent.at(-1)).toEqual({
      type: 'workbench:failure',
      error: { name: 'TypeError', message: 'Invalid owner boot config' },
    });
  });

  it('binds runtime-asset progress to the exact generic open before publication', async () => {
    const h = harness();
    h.materializerOpen.mockImplementationOnce(async (definition, options) => {
      options?.onRuntimeAssetProgress?.({
        phase: 'verify',
        assetId: 'esbuild-wasm@0.28.0/package/esbuild.wasm',
        assetIndex: 0,
        assetCount: 1,
      });
      return Object.freeze({
        projectKey: definition.storageSegment,
        projectRoot: `/.rifty/workbench/v1/projects/${definition.storageSegment}/tree`,
        acquisition: Object.freeze({ provenance: 'registry' }),
      });
    });

    await h.controller.handle({
      type: 'workbench:open-project',
      opId: 'open-progress',
      definition: definitionWire(),
    });

    expect(h.sent.slice(0, 2)).toEqual([
      {
        type: 'workbench:runtime-assets-progress',
        opId: 'open-progress',
        progress: {
          phase: 'verify',
          assetId: 'esbuild-wasm@0.28.0/package/esbuild.wasm',
          assetIndex: 0,
          assetCount: 1,
        },
      },
      expect.objectContaining({ type: 'workbench:project-opened', opId: 'open-progress' }),
    ]);
  });

  it('is the sole token gate and wrapper for PTY, preview, and Project VFS frames', async () => {
    const h = harness();
    await h.controller.handle({
      type: 'workbench:open-project',
      opId: 'open-1',
      definition: definitionWire(),
    });
    const token = h.opened().projectToken;
    const runtime = h.runtime();

    await h.controller.handle(ptyMessage(token));
    await h.controller.handle(previewMessage(token));
    await h.controller.handle(vfsMessage(token));
    expect(runtime.runtime.handleFrame).toHaveBeenNthCalledWith(1, {
      type: 'pty',
      frame: { type: 'pty:open', sid: 'terminal-1' },
    });
    expect(runtime.runtime.handleFrame).toHaveBeenNthCalledWith(2, {
      type: 'preview',
      frame: { type: 'pty:preview-req' },
    });
    expect(runtime.runtime.handleFrame).toHaveBeenNthCalledWith(3, {
      type: 'vfs',
      frame: { type: 'workbench:project-vfs-snapshot-request' },
    });

    runtime.input.emit({ type: 'pty', frame: { type: 'pty:ready', sid: 'terminal-1' } });
    runtime.input.emit({ type: 'preview', frame: { type: 'pty:preview', ports: [] } });
    runtime.input.emit({
      type: 'vfs',
      frame: {
        type: 'workbench:project-vfs-read-file-result',
        requestId: 'read-failed',
        ok: false,
        error: { name: 'Error', message: 'read failed' },
      },
    });
    expect(h.sent.slice(-3)).toEqual([
      {
        type: 'workbench:project-pty',
        projectToken: token,
        frame: { type: 'pty:ready', sid: 'terminal-1' },
      },
      {
        type: 'workbench:project-preview',
        projectToken: token,
        frame: { type: 'pty:preview', ports: [] },
      },
      {
        type: 'workbench:project-vfs',
        projectToken: token,
        frame: {
          type: 'workbench:project-vfs-read-file-result',
          requestId: 'read-failed',
          ok: false,
          error: { name: 'Error', message: 'read failed' },
        },
      },
    ]);

    const wrong = createOwnerProjectToken(() => 'wrong-owner-project');
    await h.controller.handle(ptyMessage(wrong, 'wrong-token-terminal'));
    await h.controller.handle(previewMessage(wrong));
    await h.controller.handle(vfsMessage(wrong));
    expect(runtime.runtime.handleFrame).toHaveBeenCalledTimes(3);
    expect(h.sent.slice(-3)).toEqual([
      {
        type: 'workbench:failure',
        error: { name: 'Error', message: 'Workbench project token is not active' },
      },
      {
        type: 'workbench:failure',
        error: { name: 'Error', message: 'Workbench project token is not active' },
      },
      {
        type: 'workbench:failure',
        error: { name: 'Error', message: 'Workbench project token is not active' },
      },
    ]);

    await h.controller.handle({
      type: 'workbench:close-project',
      opId: 'close-wrong-token',
      projectToken: wrong,
    });
    expect(runtime.runtime.close).not.toHaveBeenCalled();
    expect(h.sent.at(-1)).toEqual({
      type: 'workbench:failure',
      opId: 'close-wrong-token',
      error: { name: 'Error', message: 'Workbench project token is not active' },
    });
  });

  it('refuses token reuse and keeps the previous generation stale after the next open', async () => {
    const generated = ['reused-token', 'reused-token', 'fresh-token'];
    const h = harness({
      generateProjectToken() {
        const token = generated.shift();
        if (token === undefined) throw new Error('missing generated token');
        return token;
      },
    });
    await h.controller.handle({
      type: 'workbench:open-project',
      opId: 'open-first',
      definition: definitionWire('first-project'),
    });
    const staleToken = h.opened().projectToken;
    await h.controller.handle({
      type: 'workbench:close-project',
      opId: 'close-first',
      projectToken: staleToken,
    });

    await h.controller.handle({
      type: 'workbench:open-project',
      opId: 'open-collision',
      definition: definitionWire('collision-project'),
    });
    expect(h.sent.at(-1)).toEqual({
      type: 'workbench:failure',
      opId: 'open-collision',
      error: {
        name: 'Error',
        message: 'Workbench owner project token generator returned a duplicate token',
      },
    });
    expect(h.createProject).toHaveBeenCalledTimes(1);

    await h.controller.handle({
      type: 'workbench:open-project',
      opId: 'open-next',
      definition: definitionWire('next-project'),
    });
    const next = h.opened(1);
    expect(next.projectToken).toBe('fresh-token');
    await h.controller.handle(ptyMessage(staleToken, 'stale-generation'));
    await h.controller.handle(vfsMessage(staleToken));
    expect(h.runtime(1).runtime.handleFrame).not.toHaveBeenCalled();
    expect(h.sent.at(-1)).toEqual({
      type: 'workbench:failure',
      error: { name: 'Error', message: 'Workbench project token is not active' },
    });
  });

  it('fences a closing token synchronously and ACKs only after runtime teardown', async () => {
    const h = harness();
    const closeGate = deferred<void>();
    h.createProject.mockImplementationOnce(async (input) => {
      const runtime = {
        handleFrame: vi.fn(async () => {}),
        close: vi.fn(async () => {
          h.events.push('runtime-close:start');
          input.emit({ type: 'preview', frame: { type: 'pty:preview', ports: [] } });
          input.emit({
            type: 'pty',
            frame: { type: 'pty:dev-server', status: 'stopped' },
          });
          await closeGate.promise;
          h.events.push('runtime-close:end');
        }),
      } satisfies WorkbenchOwnerProjectRuntime;
      h.runtimeRecords.push({ input, runtime });
      return runtime;
    });
    await h.controller.handle({
      type: 'workbench:open-project',
      opId: 'open-1',
      definition: definitionWire(),
    });
    const token = h.opened().projectToken;
    const runtime = h.runtime();

    const closing = h.controller.handle({
      type: 'workbench:close-project',
      opId: 'close-1',
      projectToken: token,
    });
    const late = h.controller.handle(ptyMessage(token, 'late-terminal'));

    expect(runtime.runtime.handleFrame).not.toHaveBeenCalled();
    await waitUntil(() => runtime.runtime.close.mock.calls.length === 1);
    expect(h.sent.slice(-2)).toEqual([
      {
        type: 'workbench:project-preview',
        projectToken: token,
        frame: { type: 'pty:preview', ports: [] },
      },
      {
        type: 'workbench:project-pty',
        projectToken: token,
        frame: { type: 'pty:dev-server', status: 'stopped' },
      },
    ]);
    expect(h.sent.some((message) => message.type === 'workbench:project-closed')).toBe(false);
    expect(await settledOr(closing, 'pending')).toBe('pending');

    closeGate.resolve();
    await closing;
    await late;
    expect(h.sent.at(-1)).toEqual({
      type: 'workbench:project-closed',
      opId: 'close-1',
      projectToken: token,
    });
    expect(() =>
      runtime.input.emit({ type: 'pty', frame: { type: 'pty:ready', sid: 'late-output' } }),
    ).toThrow('ClosedHandleError: Workbench project output is closed');
    expect(h.events).toContain('runtime-close:end');
  });

  // Fault classes: provenance-lie × observable-order. The close fence rejects
  // new durability work, while exact commit receipt/cleanup candidates still
  // reach the VFS authority that validates their retained terminal identity.
  it('drains correlated VFS receipts after the close fence while rejecting new work', async () => {
    const h = harness();
    const closeGate = deferred<void>();
    h.createProject.mockImplementationOnce(async (input) => {
      const runtime = {
        handleFrame: vi.fn(async () => {}),
        close: vi.fn(async () => closeGate.promise),
      } satisfies WorkbenchOwnerProjectRuntime;
      h.runtimeRecords.push({ input, runtime });
      return runtime;
    });
    await h.controller.handle({
      type: 'workbench:open-project',
      opId: 'open-drain',
      definition: definitionWire(),
    });
    const token = h.opened().projectToken;
    const runtime = h.runtime().runtime;
    const terminal = {
      type: 'rifty:owner-vfs-commit-ack' as const,
      operationId: 'commit-before-close',
      ok: true as const,
      ack: {
        operationId: 'commit-before-close',
        ownerEpoch: 'owner-a',
        treeRevision: 2,
        versions: [
          {
            path: '/.rifty/workbench/v1/projects/project-a/tree/src/main.ts',
            version: 'file-v2',
          },
        ],
      },
    };

    const closing = h.controller.handle({
      type: 'workbench:close-project',
      opId: 'close-drain',
      projectToken: token,
    });
    await waitUntil(() => runtime.close.mock.calls.length === 1);

    await h.controller.handle({
      type: 'workbench:project-vfs',
      projectToken: token,
      frame: { type: 'rifty:owner-vfs-commit-received', terminal },
    });
    await h.controller.handle({
      type: 'workbench:project-vfs',
      projectToken: token,
      frame: { type: 'rifty:owner-vfs-commit-cleanup', terminal },
    });
    await h.controller.handle({
      type: 'workbench:project-vfs',
      projectToken: token,
      frame: {
        type: 'rifty:owner-vfs-durability',
        barrierId: 'barrier-before-close',
        ownerEpoch: 'owner-a',
        treeRevision: 2,
      },
    });
    await h.controller.handle(vfsMessage(token));

    expect(runtime.handleFrame.mock.calls.map(([frame]) => frame)).toEqual([
      { type: 'vfs', frame: { type: 'rifty:owner-vfs-commit-received', terminal } },
      { type: 'vfs', frame: { type: 'rifty:owner-vfs-commit-cleanup', terminal } },
    ]);

    closeGate.resolve();
    await closing;
    await h.controller.handle({
      type: 'workbench:project-vfs',
      projectToken: token,
      frame: { type: 'rifty:owner-vfs-commit-cleanup', terminal },
    });
    expect(runtime.handleFrame).toHaveBeenCalledTimes(2);
  });

  it('dispatches PTY control while an exec is pending and does not queue close behind the run', async () => {
    const h = harness();
    const execGate = deferred<void>();
    h.createProject.mockImplementationOnce(async (input) => {
      const runtime = {
        handleFrame: vi.fn(async (message) => {
          if (message.type === 'pty' && message.frame.type === 'pty:exec') {
            await execGate.promise;
          }
        }),
        close: vi.fn(async () => {}),
      } satisfies WorkbenchOwnerProjectRuntime;
      h.runtimeRecords.push({ input, runtime });
      return runtime;
    });
    await h.controller.handle({
      type: 'workbench:open-project',
      opId: 'open-1',
      definition: definitionWire(),
    });
    const token = h.opened().projectToken;
    const runtime = h.runtime();

    const running = h.controller.handle({
      type: 'workbench:project-pty',
      projectToken: token,
      frame: {
        type: 'pty:exec',
        sid: 'terminal-1',
        rid: 'run-1',
        line: 'sleep 60',
        cols: 80,
        rows: 24,
        isTTY: true,
      },
    });
    await waitUntil(() => runtime.runtime.handleFrame.mock.calls.length === 1);
    expect(await settledOr(running, 'pending')).toBe('pending');

    await h.controller.handle({
      type: 'workbench:project-pty',
      projectToken: token,
      frame: {
        type: 'pty:signal',
        sid: 'terminal-1',
        rid: 'run-1',
        signal: 'SIGINT',
      },
    });
    expect(runtime.runtime.handleFrame).toHaveBeenCalledTimes(2);
    expect(runtime.runtime.handleFrame).toHaveBeenLastCalledWith({
      type: 'pty',
      frame: {
        type: 'pty:signal',
        sid: 'terminal-1',
        rid: 'run-1',
        signal: 'SIGINT',
      },
    });

    await h.controller.handle({
      type: 'workbench:close-project',
      opId: 'close-while-exec-pending',
      projectToken: token,
    });
    expect(runtime.runtime.close).toHaveBeenCalledTimes(1);
    expect(h.sent.at(-1)).toEqual({
      type: 'workbench:project-closed',
      opId: 'close-while-exec-pending',
      projectToken: token,
    });
    expect(await settledOr(running, 'pending')).toBe('pending');
    execGate.resolve();
    await running;
  });

  it('serializes idle operations, keeps active projects exclusive, and recovers after failures', async () => {
    const h = harness();
    const firstDeleteGate = deferred<void>();
    h.materializerDelete.mockImplementationOnce(async (id) => {
      h.events.push(`delete-start:${id}`);
      await firstDeleteGate.promise;
      h.events.push(`delete-end:${id}`);
    });

    const firstDelete = h.controller.handle({
      type: 'workbench:delete-project',
      opId: 'delete-1',
      id: 'first',
    });
    const secondDelete = h.controller.handle({
      type: 'workbench:delete-project',
      opId: 'delete-2',
      id: 'second',
    });
    await waitUntil(() => h.materializerDelete.mock.calls.length === 1);
    expect(h.materializerDelete).toHaveBeenCalledWith('first');
    firstDeleteGate.resolve();
    await Promise.all([firstDelete, secondDelete]);
    expect(h.materializerDelete.mock.calls.map(([id]) => id)).toEqual(['first', 'second']);

    h.materializerOpen.mockRejectedValueOnce(new Error('injected acquisition failure'));
    await h.controller.handle({
      type: 'workbench:open-project',
      opId: 'open-fails',
      definition: definitionWire('failed-project'),
    });
    await h.controller.handle({
      type: 'workbench:open-project',
      opId: 'open-recovers',
      definition: definitionWire('live-project'),
    });
    expect(h.opened().opId).toBe('open-recovers');

    await h.controller.handle({
      type: 'workbench:open-project',
      opId: 'open-busy',
      definition: definitionWire('other-project'),
    });
    await h.controller.handle({
      type: 'workbench:delete-project',
      opId: 'delete-busy',
      id: 'live-project',
    });
    expect(h.materializerOpen).toHaveBeenCalledTimes(2);
    expect(h.materializerDelete).toHaveBeenCalledTimes(2);
    expect(h.sent.slice(-2)).toEqual([
      {
        type: 'workbench:failure',
        opId: 'open-busy',
        error: {
          name: 'ProjectBusyError',
          message: 'ProjectBusyError: Workbench already has an active run',
        },
      },
      {
        type: 'workbench:failure',
        opId: 'delete-busy',
        error: {
          name: 'ProjectBusyError',
          message: 'ProjectBusyError: Workbench already has an active run',
        },
      },
    ]);
  });

  it('keeps failed teardown poisoned, but shutdown still closes the materializer', async () => {
    const h = harness();
    const teardownFailure = new Error('injected runtime teardown failure');
    h.createProject.mockImplementationOnce(async (input) => {
      const runtime = {
        handleFrame: vi.fn(async () => {}),
        close: vi.fn(async () => {
          throw teardownFailure;
        }),
      } satisfies WorkbenchOwnerProjectRuntime;
      h.runtimeRecords.push({ input, runtime });
      return runtime;
    });
    await h.controller.handle({
      type: 'workbench:open-project',
      opId: 'open-1',
      definition: definitionWire(),
    });
    const token = h.opened().projectToken;

    await h.controller.handle({
      type: 'workbench:close-project',
      opId: 'close-fails',
      projectToken: token,
    });
    await h.controller.handle({
      type: 'workbench:delete-project',
      opId: 'delete-after-failed-close',
      id: 'project-a',
    });

    expect(h.materializerDelete).not.toHaveBeenCalled();
    expect(h.sent.slice(-2)).toEqual([
      {
        type: 'workbench:failure',
        opId: 'close-fails',
        error: { name: 'Error', message: 'injected runtime teardown failure' },
      },
      {
        type: 'workbench:failure',
        opId: 'delete-after-failed-close',
        error: {
          name: 'Error',
          message: 'Workbench owner lifecycle is poisoned: injected runtime teardown failure',
        },
      },
    ]);

    const shutdown = h.controller.handle({ type: 'workbench:shutdown' });
    const repeated = h.controller.handle({ type: 'workbench:shutdown' });
    expect(repeated).toBe(shutdown);
    await expect(shutdown).rejects.toBe(teardownFailure);
    await expect(h.controller.lifetime).rejects.toBe(teardownFailure);
    expect(h.runtime().runtime.close).toHaveBeenCalledTimes(1);
    expect(h.materializerClose).toHaveBeenCalledTimes(1);
  });

  it('shutdown fences all ingress immediately and settles lifetime after ordered cleanup', async () => {
    const h = harness();
    const runtimeCloseGate = deferred<void>();
    const materializerCloseGate = deferred<void>();
    h.createProject.mockImplementationOnce(async (input) => {
      const runtime = {
        handleFrame: vi.fn(async () => {}),
        close: vi.fn(async () => {
          h.events.push('runtime-close:start');
          input.emit({ type: 'preview', frame: { type: 'pty:preview', ports: [] } });
          await runtimeCloseGate.promise;
          h.events.push('runtime-close:end');
        }),
      } satisfies WorkbenchOwnerProjectRuntime;
      h.runtimeRecords.push({ input, runtime });
      return runtime;
    });
    h.materializerClose.mockImplementationOnce(async () => {
      h.events.push('materializer-close:start');
      await materializerCloseGate.promise;
      h.events.push('materializer-close:end');
    });
    await h.controller.handle({
      type: 'workbench:open-project',
      opId: 'open-1',
      definition: definitionWire(),
    });
    const token = h.opened().projectToken;
    const runtime = h.runtime();

    const shutdown = h.controller.handle({ type: 'workbench:shutdown' });
    expect(h.controller.handle({ type: 'workbench:shutdown' })).toBe(shutdown);
    const lateFrames = [
      h.controller.handle(ptyMessage(token, 'after-shutdown')),
      h.controller.handle(previewMessage(token)),
      h.controller.handle(vfsMessage(token)),
    ];
    const lateDelete = h.controller.handle({
      type: 'workbench:delete-project',
      opId: 'delete-after-shutdown',
      id: 'project-a',
    });

    expect(runtime.runtime.handleFrame).not.toHaveBeenCalled();
    await Promise.all([...lateFrames, lateDelete]);
    expect(
      h.sent.filter((message) => message.type === 'workbench:failure' && !('opId' in message)),
    ).toEqual([]);
    expect(h.sent).toContainEqual({
      type: 'workbench:failure',
      opId: 'delete-after-shutdown',
      error: {
        name: 'ClosedHandleError',
        message: 'ClosedHandleError: Workbench owner is closed',
      },
    });
    await waitUntil(() => runtime.runtime.close.mock.calls.length === 1);
    expect(h.materializerClose).not.toHaveBeenCalled();
    expect(await settledOr(h.controller.lifetime, 'pending')).toBe('pending');

    runtimeCloseGate.resolve();
    await waitUntil(() => h.materializerClose.mock.calls.length === 1);
    expect(h.events.slice(-2)).toEqual(['runtime-close:end', 'materializer-close:start']);
    expect(h.sent).toContainEqual({
      type: 'workbench:project-preview',
      projectToken: token,
      frame: { type: 'pty:preview', ports: [] },
    });
    expect(() =>
      runtime.input.emit({ type: 'preview', frame: { type: 'pty:preview', ports: [] } }),
    ).toThrow('ClosedHandleError: Workbench project output is closed');
    expect(await settledOr(h.controller.lifetime, 'pending')).toBe('pending');

    materializerCloseGate.resolve();
    await shutdown;
    await h.controller.lifetime;
    expect(h.events.slice(-4)).toEqual([
      'runtime-close:start',
      'runtime-close:end',
      'materializer-close:start',
      'materializer-close:end',
    ]);
    expect(h.sent.some((message) => message.type === 'workbench:project-closed')).toBe(false);
  });
});
