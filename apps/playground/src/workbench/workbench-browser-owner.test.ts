import { EventEmitter } from 'node:events';
import type { WorkerProcessHandle } from '@riftydev/kernel';
import { describe, expect, it, vi } from 'vitest';
import { ProjectDefinitionMismatchError } from './errors.ts';
import type { PageToWorkbenchOwnerMessage } from './owner-protocol.ts';
import { inspectProjectDefinition, projects } from './project-definition.ts';
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
    const raw = startBrowserWorkspaceOwner(input, dependencies(worker));

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
    const openRequest = sentOf(worker, 'workbench:open-project')[0];
    if (openRequest === undefined) throw new Error('missing open request');
    worker.emit('message', {
      type: 'workbench:project-opened',
      opId: openRequest.opId,
      projectToken: 'owner-token-a',
      projectRoot: '/owner-born/project-a',
    });

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

    expect(() => project.terminals.open()).toThrowError(
      expect.objectContaining({ name: 'ClosedHandleError' }),
    );
    raw.close();
    expect(worker.sent.at(-1)).toEqual({ type: 'workbench:shutdown' });
    worker.emit('exit', 0, null);
    await raw.closed;
    expect(worker.killedWith).toBeNull();
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
});
