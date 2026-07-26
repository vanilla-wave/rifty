import { type CommandContext, Shell } from '@riftydev/shell';
import { describe, expect, it, vi } from 'vitest';
import {
  type BinSpawnRequest,
  type BinWorkerHandle,
  createBinExecutor,
} from '../glue/bin-executor.ts';
import type { OwnerToPageFrame } from '../glue/pty-protocol.ts';
import {
  type DevServerFailure,
  type SupervisedDevServerHandle,
  createDevServerController,
} from './dev-server-controller.ts';
import type { ReserveOwnerChildAdmission } from './owner-child-admission.ts';
import { type NodeChildHandle, createOwnerChildNodeExecutor } from './owner-child-node-executor.ts';
import {
  createInstalledBinPreviewHooks,
  createNodePreviewRunHooks,
  createPreviewOriginCapture,
  runPtyDevServerShellCommand,
} from './preview-producer-bindings.ts';
import { HOST_PREVIEW_ORIGIN, createPreviewRegistry } from './preview-registry.ts';
import { createPtyServer } from './pty-server.ts';

const FORGED_PTY_SESSION_ENV = 'RIFTY_INTERNAL_PTY_SID';

const reserveEmptyAdmission: ReserveOwnerChildAdmission = async () =>
  Object.freeze({
    snapshot: Object.freeze({
      capabilityPorts: Object.freeze({}),
      dispose() {},
    }),
    commit() {},
    abortBeforeSpawn() {},
    async abortAfterChildSettlement(_error: unknown, exited: Promise<unknown>) {
      await exited;
    },
  });

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function actorHarness() {
  const gates = [deferred<void>(), deferred<void>()];
  let gateIndex = 0;
  const server = createPtyServer({
    send: () => {},
    makeShell: () => new Shell({ cwd: '/', env: {} }),
    beforeRun: () => gates[gateIndex++]!.promise,
  });
  server.handleFrame({ type: 'pty:open', sid: 'terminal-shared' });

  const start = (ptyRid: string, index: number) => {
    const running = Promise.resolve(
      server.handleFrame({
        type: 'pty:exec',
        sid: 'terminal-shared',
        rid: ptyRid,
        line: 'actor-held-command',
        cols: 80,
        rows: 24,
        isTTY: true,
      }),
    );
    const admission = server.activeAdmission('terminal-shared');
    if (admission === null) throw new Error(`actor did not admit ${ptyRid}`);
    return {
      admission,
      release: async () => {
        gates[index]!.resolve();
        await running;
      },
    };
  };

  return { server, start };
}

function producerContext(signal?: AbortSignal): CommandContext {
  return {
    cwd: '/workspace',
    env: { [FORGED_PTY_SESSION_ENV]: 'terminal-forged' },
    stdout: { write: () => {} },
    stderr: { write: () => {} },
    signal,
  };
}

function previewHarness() {
  const sent: OwnerToPageFrame[] = [];
  const previews = createPreviewRegistry({ send: (frame) => sent.push(frame) });
  const latest = () => {
    const frame = sent
      .filter(
        (candidate): candidate is Extract<OwnerToPageFrame, { type: 'pty:preview' }> =>
          candidate.type === 'pty:preview',
      )
      .at(-1);
    if (frame === undefined) throw new Error('preview registry emitted no snapshot');
    return frame;
  };
  return { previews, latest };
}

async function replaceActorRun(
  actor: ReturnType<typeof actorHarness>,
  first: ReturnType<ReturnType<typeof actorHarness>['start']>,
) {
  await first.release();
  const second = actor.start('run-b', 1);
  expect(second.admission).toMatchObject({ ptySid: 'terminal-shared', ptyRid: 'run-b' });
  return second;
}

function pendingFailure(): Promise<DevServerFailure> {
  return new Promise(() => {});
}

function controllableBinSpawn() {
  let onMessage: (message: unknown) => void = () => {};
  let onListening: (control: { ports: number[]; previewScope?: string }) => void = () => {};
  let onExit: (code?: unknown, signal?: unknown) => void = () => {};
  const spawn = vi.fn(
    (_request: BinSpawnRequest): BinWorkerHandle => ({
      stdout: () => ({ on: () => {} }),
      stderr: () => ({ on: () => {} }),
      stdin: () => {
        throw new Error('unexpected stdin access');
      },
      on: (event, listener) => {
        if (event === 'message') onMessage = listener as (message: unknown) => void;
        if (event === 'exit') {
          onExit = listener as (code?: unknown, signal?: unknown) => void;
        }
      },
      onListeningControl: (listener) => {
        onListening = listener;
      },
      resize: () => true,
      kill: () => true,
    }),
  );
  return {
    spawn,
    emitMessage: (message: unknown) => onMessage(message),
    emitListening: (control: { ports: number[]; previewScope?: string }) => onListening(control),
    emitExit: (code: number | null, signal: string | null = null) => onExit(code, signal),
  };
}

function controllableNodeSpawn() {
  let onMessage: (message: unknown) => void = () => {};
  let onListening: (control: { ports: number[]; previewScope?: string }) => void = () => {};
  let onExit: (code?: unknown, signal?: unknown) => void = () => {};
  const control = new MessageChannel();
  const handle = {
    kind: 'worker',
    ports: { ipc: control.port1 },
    stdout: () => ({ on: () => {} }),
    stderr: () => ({ on: () => {} }),
    stdin: () => {
      throw new Error('unexpected stdin access');
    },
    on: (event: string, listener: (...args: unknown[]) => void) => {
      if (event === 'message') onMessage = listener;
      if (event === 'exit') onExit = listener;
    },
    onListeningControl: (
      listener: (control: { ports: number[]; previewScope?: string }) => void,
    ) => {
      onListening = listener;
    },
    send: () => {},
    resize: () => true,
    kill: () => true,
  } as unknown as NodeChildHandle;
  return {
    spawn: vi.fn(() => handle),
    emitMessage: (message: unknown) => onMessage(message),
    emitListening: (control: { ports: number[]; previewScope?: string }) => onListening(control),
    emitExit: (code: number | null, signal: string | null = null) => {
      onExit(code, signal);
      control.port1.close();
      control.port2.close();
    },
  };
}

describe('owner preview producer admission capture', () => {
  it('uses the exact host singleton without consulting PTY admission for a host producer', () => {
    const activeAdmission = vi.fn();
    const captureOrigin = createPreviewOriginCapture(activeAdmission);

    expect(captureOrigin()).toBe(HOST_PREVIEW_ORIGIN);
    expect(activeAdmission).not.toHaveBeenCalled();
  });

  it("does not let actor A's inline env assignment acquire actor B's admission", async () => {
    const preview = previewHarness();
    const child = controllableBinSpawn();
    const holdB = deferred<number>();
    let binRunSeq = 0;
    const server = createPtyServer({
      send: () => {},
      makeShell: (_seed, ptySid) => {
        const captureOrigin = createPreviewOriginCapture(
          (sid) => server.activeAdmission(sid),
          ptySid,
        );
        const executor = createBinExecutor({
          spawn: child.spawn,
          ...createInstalledBinPreviewHooks({
            captureOrigin,
            allocateSid: () => `bin-${++binRunSeq}`,
            previews: preview.previews,
          }),
        });
        const shell = new Shell({ cwd: '/workspace', env: {} });
        shell.registerCommand('hold', () => holdB.promise);
        shell.registerCommand('launch-preview', (_args, ctx) =>
          executor('/workspace/node_modules/.bin/vite', [], ctx),
        );
        return shell;
      },
    });
    server.handleFrame({ type: 'pty:open', sid: 'terminal-a' });
    server.handleFrame({ type: 'pty:open', sid: 'terminal-b' });

    const runningB = Promise.resolve(
      server.handleFrame({
        type: 'pty:exec',
        sid: 'terminal-b',
        rid: 'run-b',
        line: 'hold',
        cols: 80,
        rows: 24,
        isTTY: true,
      }),
    );
    const runningA = Promise.resolve(
      server.handleFrame({
        type: 'pty:exec',
        sid: 'terminal-a',
        rid: 'run-a',
        line: `${FORGED_PTY_SESSION_ENV}=terminal-b launch-preview`,
        cols: 80,
        rows: 24,
        isTTY: true,
      }),
    );

    expect(server.activeAdmission('terminal-a')).toMatchObject({
      ptySid: 'terminal-a',
      ptyRid: 'run-a',
    });
    expect(server.activeAdmission('terminal-b')).toMatchObject({
      ptySid: 'terminal-b',
      ptyRid: 'run-b',
    });
    await vi.waitFor(() => expect(child.spawn).toHaveBeenCalledOnce());
    child.emitListening({
      ports: [5173],
      previewScope: 'scope-a',
    });
    const port = preview.latest().ports[0];

    child.emitExit(0);
    holdB.resolve(0);
    await Promise.all([runningA, runningB]);

    expect(port).toMatchObject({
      source: 'node',
      ptySid: 'terminal-a',
      ptyRid: 'run-a',
    });
  });

  it("does not let actor A's inline env assignment relabel its dev server as actor B", async () => {
    const preview = previewHarness();
    const holdB = deferred<number>();
    const boot = deferred<SupervisedDevServerHandle>();
    const controller = createDevServerController({
      lifecycle: preview.previews,
      boot: () => boot.promise,
    });
    const server = createPtyServer({
      send: () => {},
      makeShell: (_seed, ptySid) => {
        const captureOrigin = createPreviewOriginCapture(
          (sid) => server.activeAdmission(sid),
          ptySid,
        );
        const shell = new Shell({ cwd: '/workspace', env: {} });
        shell.registerCommand('hold', () => holdB.promise);
        shell.registerCommand('launch-dev', (_args, ctx) =>
          runPtyDevServerShellCommand({
            captureOrigin,
            controller,
            ctx,
          }),
        );
        return shell;
      },
    });
    server.handleFrame({ type: 'pty:open', sid: 'terminal-a' });
    server.handleFrame({ type: 'pty:open', sid: 'terminal-b' });

    const runningB = Promise.resolve(
      server.handleFrame({
        type: 'pty:exec',
        sid: 'terminal-b',
        rid: 'run-b',
        line: 'hold',
        cols: 80,
        rows: 24,
        isTTY: true,
      }),
    );
    const runningA = Promise.resolve(
      server.handleFrame({
        type: 'pty:exec',
        sid: 'terminal-a',
        rid: 'run-a',
        line: `${FORGED_PTY_SESSION_ENV}=terminal-b launch-dev`,
        cols: 80,
        rows: 24,
        isTTY: true,
      }),
    );

    boot.resolve({
      port: 5174,
      previewScope: 'scope-dev-a',
      failure: pendingFailure(),
      stop: async () => ({ code: null, signal: 'SIGTERM' }),
    });
    await vi.waitFor(() => expect(controller.status).toBe('running'));
    const port = preview.latest().ports[0];

    server.handleFrame({
      type: 'pty:signal',
      sid: 'terminal-a',
      rid: 'run-a',
      signal: 'SIGINT',
    });
    holdB.resolve(0);
    await Promise.all([runningA, runningB]);

    expect(port).toMatchObject({
      source: 'dev-server',
      ptySid: 'terminal-a',
      ptyRid: 'run-a',
    });
  });

  it('keeps the dev-server boot callback on run A after the actor admits B', async () => {
    const actor = actorHarness();
    const first = actor.start('run-a', 0);
    const preview = previewHarness();
    const boot = deferred<SupervisedDevServerHandle>();
    const controller = createDevServerController({
      lifecycle: preview.previews,
      boot: () => boot.promise,
    });
    const abort = new AbortController();
    const captureOrigin = createPreviewOriginCapture(
      (ptySid) => actor.server.activeAdmission(ptySid),
      'terminal-shared',
    );
    const command = runPtyDevServerShellCommand({
      captureOrigin,
      controller,
      ctx: producerContext(abort.signal),
    });

    const second = await replaceActorRun(actor, first);
    boot.resolve({
      port: 5174,
      previewScope: 'scope-dev-a',
      failure: pendingFailure(),
      stop: async () => ({ code: null, signal: 'SIGTERM' }),
    });
    await vi.waitFor(() => expect(controller.status).toBe('running'));

    expect(preview.latest().ports[0]).toMatchObject({
      source: 'dev-server',
      ptySid: 'terminal-shared',
      ptyRid: 'run-a',
    });

    abort.abort();
    await command;
    await second.release();
  });

  it('keeps an installed-bin late listening message on launch run A after B admission', async () => {
    const actor = actorHarness();
    const first = actor.start('run-a', 0);
    const preview = previewHarness();
    const child = controllableBinSpawn();
    const captureOrigin = createPreviewOriginCapture(
      (ptySid) => actor.server.activeAdmission(ptySid),
      'terminal-shared',
    );
    let binRunSeq = 0;
    const executor = createBinExecutor({
      spawn: child.spawn,
      ...createInstalledBinPreviewHooks({
        captureOrigin,
        allocateSid: () => `bin-${++binRunSeq}`,
        previews: preview.previews,
      }),
    });
    const running = executor('/workspace/node_modules/.bin/vite', [], producerContext());

    const second = await replaceActorRun(actor, first);
    child.emitListening({
      ports: [5173],
      previewScope: 'scope-bin-a',
    });

    expect(preview.latest().ports[0]).toMatchObject({
      source: 'node',
      ptySid: 'terminal-shared',
      ptyRid: 'run-a',
    });

    child.emitExit(0);
    await running;
    await second.release();
  });

  it('classifies vite preview from trusted launch args and fences a superseded late exit', () => {
    const preview = previewHarness();
    let binRunSeq = 0;
    const hooks = createInstalledBinPreviewHooks({
      captureOrigin: createPreviewOriginCapture(vi.fn()),
      allocateSid: () => `bin-${++binRunSeq}`,
      previews: preview.previews,
    });
    const ctx = producerContext();
    const request = (args: readonly string[]): BinSpawnRequest => ({
      shimPath: '/workspace/node_modules/.bin/vite',
      args,
      env: {},
      cwd: ctx.cwd,
      isTTY: false,
    });
    const first = request(['--config', 'vite.custom.ts', 'preview']);
    const second = request(['preview', '--host', '127.0.0.1']);

    hooks.onStart?.(first, ctx);
    hooks.onListening?.(first, { ports: [4173], previewScope: 'scope-first' }, ctx);
    expect(preview.latest().ports).toEqual([
      expect.objectContaining({
        port: 4173,
        source: 'preview',
        previewScope: 'scope-first',
      }),
    ]);

    hooks.onStart?.(second, ctx);
    hooks.onListening?.(second, { ports: [4174], previewScope: 'scope-second' }, ctx);
    hooks.onExit?.(first, ctx);
    expect(preview.latest().ports).toEqual([
      expect.objectContaining({
        port: 4174,
        source: 'preview',
        previewScope: 'scope-second',
      }),
    ]);

    hooks.onExit?.(second, ctx);
    expect(preview.latest().ports).toEqual([]);
  });

  it('keeps a node-child late listening message on launch run A after B admission', async () => {
    const actor = actorHarness();
    const first = actor.start('run-a', 0);
    const preview = previewHarness();
    const child = controllableNodeSpawn();
    const executor = createOwnerChildNodeExecutor(
      'node-entry',
      { RIFTY_KERNEL_WORKER_URL: 'kernel-entry' },
      reserveEmptyAdmission,
      child.spawn,
    );
    const ctx = producerContext();
    const captureOrigin = createPreviewOriginCapture(
      (ptySid) => actor.server.activeAdmission(ptySid),
      'terminal-shared',
    );
    const hooks = createNodePreviewRunHooks({
      captureOrigin,
      previews: preview.previews,
      cwd: ctx.cwd,
      sid: 'node-a',
      previewScope: 'scope-node-a',
    });
    const running = executor('/workspace/server.js', [], ctx, hooks);
    await vi.waitFor(() => expect(child.spawn).toHaveBeenCalledOnce());

    const second = await replaceActorRun(actor, first);
    child.emitListening({ ports: [3000] });

    expect(preview.latest().ports[0]).toMatchObject({
      source: 'node',
      ptySid: 'terminal-shared',
      ptyRid: 'run-a',
    });

    child.emitExit(0);
    await running;
    await second.release();
  });

  it('refuses a PTY-marked installed-bin launch when the actor has no admission', async () => {
    const actor = actorHarness();
    const preview = previewHarness();
    const child = controllableBinSpawn();
    const captureOrigin = createPreviewOriginCapture(
      (ptySid) => actor.server.activeAdmission(ptySid),
      'terminal-shared',
    );
    const executor = createBinExecutor({
      spawn: child.spawn,
      ...createInstalledBinPreviewHooks({
        captureOrigin,
        allocateSid: () => 'bin-1',
        previews: preview.previews,
      }),
    });

    await expect(
      executor('/workspace/node_modules/.bin/vite', [], producerContext()),
    ).rejects.toThrow('no active PTY admission for terminal-shared');
    expect(child.spawn).not.toHaveBeenCalled();
  });
});
