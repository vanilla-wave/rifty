import { describe, expect, it, vi } from 'vitest';
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
import type { ProjectMaterializer } from '../workbench/project-materialization.ts';
import type { PlaygroundProjectAuthority } from './playground-project-authority.ts';
import {
  type WorkbenchOwnerProjectRuntime,
  type WorkbenchOwnerProjectRuntimeInput,
  createWorkbenchOwnerController,
} from './workbench-owner-controller.ts';

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

  const materializerOpen = vi.fn(async (definition: Parameters<ProjectMaterializer['open']>[0]) => {
    events.push(`materialize:${definition.id}`);
    return Object.freeze({
      projectKey: definition.storageSegment,
      projectRoot: `/.rifty/workbench/v1/projects/${definition.storageSegment}/tree`,
      acquisition: Object.freeze({ provenance: 'registry' }),
    });
  });
  const materializerDelete = vi.fn(async (id: string) => {
    events.push(`delete:${id}`);
  });
  const materializerClose = vi.fn(async () => {
    events.push('materializer-close');
  });
  const materializer: ProjectMaterializer = {
    open: materializerOpen,
    delete: materializerDelete,
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

  const controller = createWorkbenchOwnerController({
    materializer,
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
  // new project work, but completion legs admitted before it still drain.
  it('drains admitted VFS completion frames after the close fence while rejecting new work', async () => {
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
      {
        type: 'vfs',
        frame: {
          type: 'rifty:owner-vfs-durability',
          barrierId: 'barrier-before-close',
          ownerEpoch: 'owner-a',
          treeRevision: 2,
        },
      },
    ]);

    closeGate.resolve();
    await closing;
    await h.controller.handle({
      type: 'workbench:project-vfs',
      projectToken: token,
      frame: { type: 'rifty:owner-vfs-commit-cleanup', terminal },
    });
    expect(runtime.handleFrame).toHaveBeenCalledTimes(3);
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
