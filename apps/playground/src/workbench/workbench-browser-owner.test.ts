import { EventEmitter } from 'node:events';
import type { WorkerProcessHandle } from '@riftydev/kernel';
import { SW_FRAME_VERSION, SW_PONG, SW_ROUTING_VERSION } from '@riftydev/service-worker';
import { describe, expect, it, vi } from 'vitest';
import type { VfsSnapshotEntry } from '../glue/vfs-snapshot-port.ts';
import {
  DirtyProjectDocumentError,
  ProjectDefinitionMismatchError,
  ProjectFileOperationError,
} from './errors.ts';
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

class FakeOwnerWorker extends EventEmitter {
  readonly kind = 'worker' as const;
  readonly sent: PageToWorkbenchOwnerMessage[] = [];
  readonly output = new EventEmitter();
  killedWith: string | null = null;

  send(message: unknown): boolean {
    this.sent.push(message as PageToWorkbenchOwnerMessage);
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
