import { EventEmitter } from 'node:events';
import type { WorkerProcessHandle } from '@riftydev/kernel';
import { SW_FRAME_VERSION, SW_PONG, SW_ROUTING_VERSION } from '@riftydev/service-worker';
import { describe, expect, it, vi } from 'vitest';
import type { VfsSnapshotEntry } from '../glue/vfs-snapshot-port.ts';
import {
  type WorkbenchOwnerProjectRuntime,
  type WorkbenchOwnerProjectRuntimeInput,
  createWorkbenchOwnerController,
} from '../workers/workbench-owner-controller.ts';
import {
  DirtyProjectDocumentError,
  ProjectDefinitionMismatchError,
  ProjectFileOperationError,
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
import type { ProjectMaterializer } from './project-materialization.ts';
import { startBrowserWorkspaceOwner, workbenchOwnerSpawnSpec } from './workbench-browser-owner.ts';
import type {
  WorkbenchOwnerHealthEvent,
  WorkbenchOwnerStartInput,
} from './workbench-owner-port.ts';

const input: WorkbenchOwnerStartInput = Object.freeze({
  deployment: Object.freeze({
    workers: Object.freeze({
      owner: '/workers/workbench-owner.js',
      kernel: '/workers/kernel.js',
      node: '/workers/node.js',
      devServer: '/workers/dev-server.js',
    }),
    wasm: Object.freeze({ sqlite: '/wasm/sqlite.wasm' }),
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

type PageToPhysicalOwnerMessage = PageToWorkbenchOwnerMessage | PageToPlaygroundOwnerMessage;

class FakeOwnerWorker extends EventEmitter {
  readonly kind = 'worker' as const;
  readonly sent: PageToPhysicalOwnerMessage[] = [];
  readonly output = new EventEmitter();
  killedWith: string | null = null;
  receive: ((message: PageToPhysicalOwnerMessage) => void) | null = null;

  constructor(private readonly exitOnKill = true) {
    super();
  }

  send(message: unknown): boolean {
    const inspected = message as PageToPhysicalOwnerMessage;
    this.sent.push(inspected);
    this.receive?.(inspected);
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
    if (this.exitOnKill) this.emit('exit', null, signal);
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
  // Fault class: unbounded-read. Every finite opId request has one deadline at
  // the correlation owner; an indeterminate mutation terminally fences owner state.
  it('times out a hung finite owner request and terminates the indeterminate owner', async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakeOwnerWorker();
      const raw = startBrowserWorkspaceOwner(input, dependencies(worker));
      void raw.closed.catch(() => {});
      worker.emit('message', {
        type: 'workbench:owner-ready',
        storage: { policy: 'ephemeral', backend: 'memory', durability: 'ephemeral' },
      });
      await raw.ready;

      const deleting = raw.deleteProject('hung-delete');
      void deleting.catch(() => {});
      await vi.runAllTimersAsync();

      await expect(deleting).rejects.toThrow(/owner.*delete.*timed out/i);
      expect(worker.killedWith).toBe('SIGTERM');
    } finally {
      vi.useRealTimers();
    }
  });

  it('spawns one run-to-completion owner with no config or binding in process env', () => {
    expect(workbenchOwnerSpawnSpec(input)).toEqual({
      entry: { kind: 'url', url: '/workers/workbench-owner.js' },
      argv: ['rifty', 'workbench-owner'],
      env: {},
      cwd: '/',
      serve: false,
    });
  });

  it('MessagePort peer-death fault: rejects owner readiness and lifetime with the cause', async () => {
    const worker = new FakeOwnerWorker();
    const raw = startBrowserWorkspaceOwner(input, dependencies(worker));
    let readyReason: unknown = 'pending';
    let closedReason: unknown = 'pending';
    void raw.ready.catch((reason: unknown) => {
      readyReason = reason;
    });
    void raw.closed.catch((reason: unknown) => {
      closedReason = reason;
    });
    const peerFailure = new Error('Workbench owner peer died');

    try {
      worker.emit('peererror', peerFailure);
      await settleMicrotasks();
      expect([readyReason, closedReason]).toEqual([peerFailure, peerFailure]);
    } finally {
      raw.close();
      worker.emit('exit', null, 'SIGTERM');
      await settleMicrotasks();
    }
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
    const ownerHealth = vi.fn();
    raw.subscribeHealth?.(ownerHealth);
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

    worker.emit('message', {
      type: 'workbench:playground-project-tools',
      projectToken: 'playground-owner-token',
      frame: {
        type: 'workbench:playground-session-tools-operational-health',
        health: {
          scope: 'scm',
          status: 'degraded',
          error: { name: 'GitError', message: 'index read failed before page subscription' },
        },
      },
    });
    const lifecycle = companion.sessionTools(project);
    expect(companion.sessionTools(project)).toBe(lifecycle);
    expect(() => companion.sessionTools({ ...project })).toThrow(TypeError);
    const operationalHealth = vi.fn();
    lifecycle.subscribeOperationalHealth(operationalHealth);
    expect(operationalHealth).toHaveBeenCalledWith({
      scope: 'scm',
      status: 'degraded',
      error: { name: 'GitError', message: 'index read failed before page subscription' },
    });
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
    const previewFailure = new Error('transient route mount failure');
    deps.mountPreview.mockImplementationOnce(() => {
      throw previewFailure;
    });
    worker.emit('message', {
      type: 'workbench:project-preview',
      projectToken: 'playground-owner-token',
      frame: {
        type: 'pty:preview',
        ports: [
          {
            port: 4300,
            url: '/preview/4300/',
            label: 'restarted preview',
            source: 'preview',
            sid: 'preview-restarted',
            previewScope: 'scope-restarted',
          },
        ],
      },
    });
    await vi.waitFor(() => {
      expect(operationalHealth).toHaveBeenLastCalledWith({
        scope: 'preview',
        status: 'degraded',
        error: { name: 'Error', message: previewFailure.message },
      });
    });
    expect(lifecycle.tools.previews.snapshot()).toEqual([]);
    expect(worker.killedWith).toBeNull();

    const recoveringPreview = lifecycle.recoverOperationalHealth('preview');
    await vi.waitFor(() => expect(serviceWorker.controller.messages).toHaveLength(2));
    serviceWorker.pong(1);
    await expect(recoveringPreview).resolves.toBeUndefined();
    expect(operationalHealth).toHaveBeenLastCalledWith({
      scope: 'preview',
      status: 'healthy',
    });
    expect(lifecycle.tools.previews.snapshot()).toEqual([
      {
        port: 4300,
        url: '/preview/4300/',
        label: 'restarted preview',
        source: 'preview',
      },
    ]);

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
    expect(ownerHealth).toHaveBeenCalledWith({
      kind: 'fatal-invariant',
      summary: 'Workbench protocol invariant failed',
    });
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

  it('observable-order fault: a late VFS frame after the close fence cannot kill the owner or strand close', async () => {
    const worker = new FakeOwnerWorker();
    let releaseRuntimeClose!: () => void;
    const runtimeCloseGate = new Promise<void>((resolve) => {
      releaseRuntimeClose = resolve;
    });
    const runtimeClose = vi.fn(async () => runtimeCloseGate);
    const materializer: ProjectMaterializer = {
      open: vi.fn(async (definition) =>
        Object.freeze({
          projectKey: definition.storageSegment,
          projectRoot: '/owner-born/project-a',
          acquisition: Object.freeze({ provenance: 'registry' as const }),
        }),
      ),
      delete: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    };
    const controller = createWorkbenchOwnerController({
      materializer,
      createProject: vi.fn(
        async (
          runtimeInput: WorkbenchOwnerProjectRuntimeInput,
        ): Promise<WorkbenchOwnerProjectRuntime> =>
          Object.freeze({
            handleFrame: vi.fn(async (message) => {
              await Promise.resolve();
              if (
                message.type === 'vfs' &&
                message.frame.type === 'workbench:project-vfs-snapshot-request'
              ) {
                runtimeInput.emit({
                  type: 'vfs',
                  frame: {
                    type: 'workbench:project-vfs-snapshot',
                    frame: {
                      type: 'snapshot',
                      root: runtimeInput.materialized.projectRoot,
                      ownerEpoch: 'loopback-owner-epoch',
                      treeRevision: 1,
                      entries: [],
                      nodeModulesPresent: false,
                    },
                  },
                });
              } else if (message.type === 'pty' && message.frame.type === 'pty:open') {
                runtimeInput.emit({
                  type: 'pty',
                  frame: { type: 'pty:ready', sid: message.frame.sid },
                });
              } else if (message.type === 'pty' && message.frame.type === 'pty:close') {
                runtimeInput.emit({
                  type: 'pty',
                  frame: {
                    type: 'pty:close-ack',
                    sid: message.frame.sid,
                    opId: message.frame.opId,
                    ok: true,
                  },
                });
              }
            }),
            close: runtimeClose,
          }),
      ),
      send(message) {
        worker.emit('message', structuredClone(message));
      },
    });
    worker.receive = (message) => {
      if (message.type === 'workbench:initialize') return;
      const operation = controller.handle(message);
      void operation.catch(() => {});
    };

    const raw = startBrowserWorkspaceOwner(input, dependencies(worker));
    void raw.closed.catch(() => {});
    worker.emit('message', {
      type: 'workbench:owner-ready',
      storage: { policy: 'ephemeral', backend: 'memory', durability: 'ephemeral' },
    });
    await raw.ready;
    const project = await raw.openProject(
      inspectProjectDefinition(
        projects.vite({ id: 'project-a', files: { '/index.html': '<h1>A</h1>' } }),
      ),
    );

    const closing = project.close();
    await settleMicrotasks();
    const closeRequest = sentOf(worker, 'workbench:close-project')[0];
    if (closeRequest === undefined) throw new Error('missing close request');

    await controller.handle({
      type: 'workbench:project-vfs',
      projectToken: closeRequest.projectToken,
      frame: { type: 'workbench:project-vfs-snapshot-request' },
    });
    releaseRuntimeClose();
    const closeFailure = await closing.then(
      () => null,
      (error: unknown) => error,
    );

    expect.soft(closeFailure).toBeNull();
    expect.soft(worker.killedWith).toBeNull();
    expect(runtimeClose).toHaveBeenCalledTimes(1);
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

  it('publishes automatic VFS durability failure and exact recovery without killing the owner', async () => {
    const worker = new FakeOwnerWorker();
    const raw = startBrowserWorkspaceOwner(input, dependencies(worker));
    const health: WorkbenchOwnerHealthEvent[] = [];
    raw.subscribeHealth?.((event) => health.push(event));
    worker.emit('message', {
      type: 'workbench:owner-ready',
      storage: { policy: 'ephemeral', backend: 'memory', durability: 'ephemeral' },
    });
    await raw.ready;

    const root = '/owner-born/project-a';
    const ownerEpoch = 'epoch:owner-token-a';
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
    if (commit?.frame.type !== 'rifty:owner-vfs-commit') throw new Error('missing commit');
    const request = commit.frame.request;
    const terminal = {
      type: 'rifty:owner-vfs-commit-ack',
      operationId: request.operationId,
      ok: true,
      ack: {
        operationId: request.operationId,
        ownerEpoch,
        treeRevision: 2,
        versions: [{ path: `${root}/src/main.ts`, version: 'file-v2' }],
      },
    } as const;
    worker.emit('message', {
      type: 'workbench:project-vfs',
      projectToken: 'owner-token-a',
      frame: terminal,
    });
    worker.emit('message', {
      type: 'workbench:project-vfs',
      projectToken: 'owner-token-a',
      frame: {
        type: 'workbench:project-vfs-state',
        fromTreeRevision: 1,
        mutations: [],
        frame: {
          type: 'snapshot',
          root,
          ownerEpoch,
          treeRevision: 2,
          nodeModulesPresent: false,
          entries: [
            { path: `${root}/src`, kind: 'dir', size: 0, version: 'dir-v2' },
            {
              path: `${root}/src/main.ts`,
              kind: 'file',
              size: 4,
              content: encoder.encode('next'),
              version: 'file-v2',
            },
          ],
        },
      },
    });
    await settleMicrotasks();
    const firstBarrier = sentOf(worker, 'workbench:project-vfs').find(
      (message) => message.frame.type === 'rifty:owner-vfs-durability',
    );
    if (firstBarrier?.frame.type !== 'rifty:owner-vfs-durability') {
      throw new Error('missing first durability barrier');
    }
    worker.emit('message', {
      type: 'workbench:project-vfs',
      projectToken: 'owner-token-a',
      frame: {
        type: 'rifty:owner-vfs-durability-ack',
        barrierId: firstBarrier.frame.barrierId,
        ok: false,
        error: {
          kind: 'persistence-failure',
          name: 'PersistFailureError',
          message: 'private OPFS quota detail',
        },
      },
    });
    await expect(writing).rejects.toBeInstanceOf(ProjectFileOperationError);
    expect(worker.killedWith).toBeNull();
    expect(health).toHaveLength(1);
    const degraded = health[0];
    if (degraded?.kind !== 'persistence' || degraded.status !== 'degraded') {
      throw new Error('missing persistence degradation');
    }

    const recovering = degraded.recover();
    await settleMicrotasks();
    const barriers = sentOf(worker, 'workbench:project-vfs').filter(
      (message) => message.frame.type === 'rifty:owner-vfs-durability',
    );
    const retry = barriers.at(-1);
    if (retry?.frame.type !== 'rifty:owner-vfs-durability') {
      throw new Error('missing recovery durability barrier');
    }
    expect(retry.frame.barrierId).not.toBe(firstBarrier.frame.barrierId);
    worker.emit('message', {
      type: 'workbench:project-vfs',
      projectToken: 'owner-token-a',
      frame: {
        type: 'rifty:owner-vfs-durability-ack',
        barrierId: retry.frame.barrierId,
        ok: true,
        receipt: { ownerEpoch, treeRevision: 2, durability: 'ephemeral' },
      },
    });
    await expect(recovering).resolves.toBeUndefined();
    expect(health.map((event) => [event.kind, 'status' in event ? event.status : null])).toEqual([
      ['persistence', 'degraded'],
      ['persistence', 'healthy'],
    ]);

    raw.close();
    worker.emit('exit', 0, null);
    await raw.closed;
  });

  it('routes impossible VFS commit correlation to fatal invariant health', async () => {
    const worker = new FakeOwnerWorker(false);
    const raw = startBrowserWorkspaceOwner(input, dependencies(worker));
    void raw.closed.catch(() => {});
    const health = vi.fn();
    raw.subscribeHealth?.(health);
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
    const expectedVersion = project.files
      .snapshot()
      .entries.find((entry) => entry.path === '/src/main.ts')?.version;
    if (expectedVersion === undefined) throw new Error('initial file version missing');
    const writing = project.files.writeFile('/src/main.ts', encoder.encode('next'), {
      expectedVersion,
    });
    void writing.catch(() => {});
    const lostWrite = project.files.writeFile('/src/lost.ts', encoder.encode('lost'), {
      expectedVersion: null,
    });
    let lostSettled = false;
    void lostWrite.then(
      () => {
        lostSettled = true;
      },
      () => {
        lostSettled = true;
      },
    );
    const commit = sentOf(worker, 'workbench:project-vfs').find(
      (message) => message.frame.type === 'rifty:owner-vfs-commit',
    );
    if (commit?.frame.type !== 'rifty:owner-vfs-commit') throw new Error('missing commit');
    worker.emit('message', {
      type: 'workbench:project-vfs',
      projectToken: 'owner-token-a',
      frame: {
        type: 'rifty:owner-vfs-commit-ack',
        operationId: commit.frame.request.operationId,
        ok: true,
        ack: {
          operationId: commit.frame.request.operationId,
          ownerEpoch: 'foreign-owner',
          treeRevision: 2,
          versions: [{ path: `${root}/src/main.ts`, version: 'file-v2' }],
        },
      },
    });

    expect(health).toHaveBeenCalledWith({
      kind: 'fatal-invariant',
      summary: 'Workbench protocol invariant failed',
    });
    expect(worker.killedWith).toBe('SIGTERM');
    await settleMicrotasks();
    expect(lostSettled).toBe(false);
    worker.emit('exit', null, 'SIGTERM');
    await expect(lostWrite).rejects.toBeInstanceOf(ProjectFileOperationError);
    await expect(raw.closed).rejects.toThrow('foreign-owner');
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

  it('observable-order fault: run close waits for the shared route revocation proof', async () => {
    const worker = new FakeOwnerWorker();
    const serviceWorker = new ControlledServiceWorkerContainer();
    const routeEvents: string[] = [];
    const deps = {
      ...dependencies(worker),
      serviceWorker,
      mountPreview: vi.fn(() => () => {
        routeEvents.push('goodbye-enqueued');
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

    const closing = run.close();
    let closeSettled = false;
    void closing
      .finally(() => {
        closeSettled = true;
      })
      .catch(() => {});
    worker.emit('message', {
      type: 'workbench:project-preview',
      projectToken: 'owner-token-a',
      frame: { type: 'pty:preview', ports: [] },
    });
    await settleMicrotasks();
    expect(routeEvents).toEqual(['goodbye-enqueued']);
    expect(serviceWorker.controller.messages).toHaveLength(2);

    const exactExit = { code: null, signal: 'SIGTERM' } as const;
    worker.emit('message', {
      type: 'workbench:project-pty',
      projectToken: 'owner-token-a',
      frame: {
        type: 'pty:exit',
        sid: exec.frame.sid,
        rid: exec.frame.rid,
        code: 130,
        exit: exactExit,
        cwd: '/owner-born/project-a',
        env: {},
      },
    });
    await settleMicrotasks();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(closeSettled).toBe(false);

    serviceWorker.pong(1);
    await expect(closing).resolves.toBe(exactExit);

    const projectClosing = project.close();
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
    await projectClosing;

    raw.close();
    worker.emit('exit', 0, null);
    await raw.closed;
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

  // ADR-0359 (#256 drain-progress, epic project-open-drain-latency I1) —
  // committed RED-first carrier. Worker-realm drain counts ride the EXISTING
  // owner→page durability channel (the workbench:project-vfs frame family
  // that already feeds onDurabilityState → publishHealth); the page publishes
  // them as a new `{ kind: 'durability-progress', persisted, total }` member
  // of WorkbenchOwnerHealthEvent. Neither the owner frame nor the health kind
  // exists on main — the assertion fails at runtime (no compile error: events
  // are matched via structural casts). Monotonicity/coalescing is owned by
  // the WORKER-side emitter (ADR-0359 Consequences: O(progress) at the
  // emitter); the page hop pinned here forwards exact frames in order.
  it('publishes owner drain-progress frames as durability-progress health events (ADR-0359 — DESIGNED RED on main)', async () => {
    const worker = new FakeOwnerWorker();
    const raw = startBrowserWorkspaceOwner(input, dependencies(worker));
    void raw.closed.catch(() => {});
    const health: WorkbenchOwnerHealthEvent[] = [];
    raw.subscribeHealth?.((event) => health.push(event));
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
    await opening;

    // Designed owner→page frame (absent on main): coalesced REAL counts from
    // the drain owner, one mid-drain snapshot then the terminal completion.
    for (const counts of [
      { persisted: 3, total: 10 },
      { persisted: 10, total: 10 },
    ]) {
      worker.emit('message', {
        type: 'workbench:project-vfs',
        projectToken: 'owner-token-a',
        frame: { type: 'rifty:owner-vfs-durability-progress', ...counts },
      });
    }
    await settleMicrotasks();

    const progress = health
      .filter((event) => (event as { readonly kind: string }).kind === 'durability-progress')
      .map((event) => {
        const shaped = event as unknown as {
          readonly kind: string;
          readonly persisted: number;
          readonly total: number;
        };
        return { kind: shaped.kind, persisted: shaped.persisted, total: shaped.total };
      });
    // DESIGNED RED on main: no durability-progress handling exists anywhere in
    // packages/workbench — the unknown frame trips the protocol inspector into
    // fatal-invariant instead and the listener sees no progress event.
    expect(progress).toEqual([
      { kind: 'durability-progress', persisted: 3, total: 10 },
      { kind: 'durability-progress', persisted: 10, total: 10 },
    ]);
    // Progress is health, never failure: the owner stays alive and unkilled.
    expect(health.some((event) => event.kind === 'fatal-invariant')).toBe(false);
    expect(worker.killedWith).toBeNull();

    raw.close();
    worker.emit('exit', 0, null);
    await raw.closed;
  });

  // #256 first-open-progress (epic project-open-drain-latency I1; ADR-0359
  // correction 2026-08-16) — committed RED-first carrier. The FIRST-OPEN
  // materialization drain completes before any project runtime exists, so
  // progress rides an owner-LEVEL `workbench:durability-progress` control
  // message published straight to the owner-level health stream — no project
  // token gate, delivery valid with NO project open at all. RED on main: the
  // unknown owner message trips the protocol inspector into fatal-invariant
  // and no durability-progress health event is delivered.
  it('publishes owner-level durability-progress messages with no project open (first-open unit — DESIGNED RED on main)', async () => {
    const worker = new FakeOwnerWorker();
    const raw = startBrowserWorkspaceOwner(input, dependencies(worker));
    void raw.closed.catch(() => {});
    const health: WorkbenchOwnerHealthEvent[] = [];
    raw.subscribeHealth?.((event) => health.push(event));
    worker.emit('message', {
      type: 'workbench:owner-ready',
      storage: { policy: 'ephemeral', backend: 'memory', durability: 'ephemeral' },
    });
    await raw.ready;

    // First-open drain window: NO openProject has been requested yet.
    for (const counts of [
      { persisted: 4, total: 12 },
      { persisted: 12, total: 12 },
    ]) {
      worker.emit('message', { type: 'workbench:durability-progress', ...counts });
    }
    await settleMicrotasks();

    const progress = health
      .filter((event) => (event as { readonly kind: string }).kind === 'durability-progress')
      .map((event) => {
        const shaped = event as unknown as {
          readonly kind: string;
          readonly persisted: number;
          readonly total: number;
        };
        return { kind: shaped.kind, persisted: shaped.persisted, total: shaped.total };
      });
    expect(progress).toEqual([
      { kind: 'durability-progress', persisted: 4, total: 12 },
      { kind: 'durability-progress', persisted: 12, total: 12 },
    ]);
    // Progress is health, never failure: the owner stays alive and unkilled.
    expect(health.some((event) => event.kind === 'fatal-invariant')).toBe(false);
    expect(worker.killedWith).toBeNull();

    raw.close();
    worker.emit('exit', 0, null);
    await raw.closed;
  });
});
