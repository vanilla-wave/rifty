import { EventEmitter } from 'node:events';
import { Shell } from '@riftydev/shell';
import { MemoryFsSync, resetSyncMirror } from '@riftydev/vfs/internal';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPtyClient } from '../glue/pty-client.ts';
import type {
  OwnerToPageFrame,
  PageToOwnerFrame,
  PtyCompleteResult,
} from '../glue/pty-protocol.ts';
import { type ForegroundChildHandle, runForegroundChild } from '../glue/run-foreground-child.ts';
import { inspectOwnerPtyFrame, inspectPagePtyFrame } from '../workbench/owner-protocol-pty.ts';
import type { ReserveOwnerChildAdmission } from './owner-child-admission.ts';
import { type DevServerChildHandle, createOwnerChildDevServer } from './owner-child-dev-server.ts';
import { createPtyServer } from './pty-server.ts';

const reserveEmptyAdmission: ReserveOwnerChildAdmission = async () =>
  Object.freeze({
    snapshot: Object.freeze({
      runtimeBindings: Object.freeze([]),
    }),
    commit() {},
    abortBeforeSpawn() {},
    async abortAfterChildSettlement(_error: unknown, exited: Promise<unknown>) {
      await exited;
    },
  });

function harness() {
  const out: OwnerToPageFrame[] = [];
  const server = createPtyServer({
    send: (f) => out.push(f),
    makeShell: () => new Shell({ cwd: '/', env: {} }),
  });
  return { server, out };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const settledOr = <T>(promise: Promise<T>, pending: T): Promise<T> =>
  Promise.race([promise, new Promise<T>((resolve) => setTimeout(() => resolve(pending), 50))]);

class ResizeRejectingDevChild extends EventEmitter implements DevServerChildHandle {
  readonly kind = 'worker';
  readonly #control = new MessageChannel();
  readonly ports = { ipc: this.#control.port1 };
  rejectResize = false;
  readonly #stdout = new EventEmitter();
  readonly #stderr = new EventEmitter();
  #exited = false;

  stdout(): EventEmitter {
    return this.#stdout;
  }

  stderr(): EventEmitter {
    return this.#stderr;
  }

  resize(): boolean {
    return !this.rejectResize;
  }

  kill(): boolean {
    if (this.#exited) return false;
    this.#exited = true;
    this.#control.port1.close();
    this.#control.port2.close();
    queueMicrotask(() => this.emit('exit', null, 'SIGTERM'));
    return true;
  }
}

function completionResults(out: readonly OwnerToPageFrame[]): readonly PtyCompleteResult[] {
  return out.filter((frame): frame is PtyCompleteResult => frame.type === 'pty:complete-result');
}

function envelopeMutations(
  base: Readonly<Record<string, unknown>>,
  wrongValues: Readonly<Record<string, readonly unknown[]>>,
): readonly unknown[] {
  const mutations: unknown[] = [];
  for (const field of Object.keys(base)) {
    const missing = { ...base };
    Reflect.deleteProperty(missing, field);
    mutations.push(missing);
    for (const value of wrongValues[field] ?? []) mutations.push({ ...base, [field]: value });
  }
  return mutations;
}

class ReaddirFailingMemoryFsSync extends MemoryFsSync {
  #failure: Error | null = null;

  failNextReaddir(error: Error): void {
    this.#failure = error;
  }

  override readdirSync(path: string) {
    const failure = this.#failure;
    this.#failure = null;
    if (failure !== null) throw failure;
    return super.readdirSync(path);
  }
}

describe('pty-server', () => {
  beforeEach(() => {
    resetSyncMirror(); // fresh in-memory owner store per test
  });

  it('strictly inspects exact clone-safe completion request and result frames', () => {
    const request = {
      type: 'pty:complete',
      sid: 'completion-protocol',
      opId: 'complete-1',
      line: 'vi',
      cursor: 2,
    } as const;
    const success = {
      type: 'pty:complete-result',
      sid: request.sid,
      opId: request.opId,
      ok: true,
      result: {
        start: 0,
        end: 2,
        items: [{ value: 'vite ', display: 'vite' }, { value: 'vitest ' }],
      },
    } as const;
    const empty = {
      type: 'pty:complete-result',
      sid: request.sid,
      opId: 'complete-2',
      ok: true,
      result: null,
    } as const;
    const failure = {
      type: 'pty:complete-result',
      sid: request.sid,
      opId: 'complete-3',
      ok: false,
      error: 'owner completion failed',
    } as const;

    expect(inspectPagePtyFrame(structuredClone(request))).toEqual(request);
    expect(inspectOwnerPtyFrame(structuredClone(success))).toEqual(success);
    expect(inspectOwnerPtyFrame(structuredClone(empty))).toEqual(empty);
    expect(inspectOwnerPtyFrame(structuredClone(failure))).toEqual(failure);

    const invalidPageFrames: readonly unknown[] = [
      ...envelopeMutations(request, {
        type: ['pty:not-complete'],
        sid: ['', 1],
        opId: ['', 1],
        line: [1],
        cursor: ['2'],
      }),
      { ...request, extra: true },
      { ...request, cursor: -1 },
      { ...request, cursor: 1.5 },
      { ...request, cursor: Number.NaN },
      { ...request, cursor: Number.POSITIVE_INFINITY },
      { ...request, cursor: Number.NEGATIVE_INFINITY },
      { ...request, cursor: Number.MAX_SAFE_INTEGER + 1 },
      { ...request, cursor: request.line.length + 1 },
    ];
    const invalidOffsets = [
      { start: -1, end: 2 },
      { start: 0.5, end: 2 },
      { start: Number.NaN, end: 2 },
      { start: Number.POSITIVE_INFINITY, end: 2 },
      { start: Number.NEGATIVE_INFINITY, end: 2 },
      { start: Number.MAX_SAFE_INTEGER + 1, end: Number.MAX_SAFE_INTEGER + 1 },
      { start: 0, end: -1 },
      { start: 0, end: 1.5 },
      { start: 0, end: Number.NaN },
      { start: 0, end: Number.POSITIVE_INFINITY },
      { start: 0, end: Number.NEGATIVE_INFINITY },
      { start: 0, end: Number.MAX_SAFE_INTEGER + 1 },
      { start: 2, end: 1 },
    ];
    const invalidOwnerFrames: readonly unknown[] = [
      ...envelopeMutations(success, {
        type: ['pty:not-complete-result'],
        sid: ['', 1],
        opId: ['', 1],
        ok: [false, 'true'],
        result: ['vite'],
      }),
      ...envelopeMutations(failure, {
        type: ['pty:not-complete-result'],
        sid: ['', 1],
        opId: ['', 1],
        ok: [true, 'false'],
        error: ['', 1],
      }),
      { ...success, extra: true },
      { ...success, result: { ...success.result, extra: true } },
      ...envelopeMutations(success.result, {
        start: ['0'],
        end: ['2'],
        items: ['vite'],
      }).map((result) => ({ ...success, result })),
      ...invalidOffsets.map((offsets) => ({
        ...success,
        result: { ...success.result, ...offsets },
      })),
      { ...success, result: { ...success.result, items: [{}] } },
      { ...success, result: { ...success.result, items: [{ value: '' }] } },
      { ...success, result: { ...success.result, items: [{ value: 1 }] } },
      { ...success, result: { ...success.result, items: [{ value: 'vite ', display: '' }] } },
      { ...success, result: { ...success.result, items: [{ value: 'vite ', display: 1 }] } },
      { ...success, result: { ...success.result, items: [{ value: 'vite ', extra: true }] } },
      { ...failure, result: null },
      { ...failure, extra: true },
    ];
    for (const frame of invalidPageFrames) {
      expect(() => inspectPagePtyFrame(structuredClone(frame))).toThrow(TypeError);
    }
    for (const frame of invalidOwnerFrames) {
      expect(() => inspectOwnerPtyFrame(structuredClone(frame))).toThrow(TypeError);
    }
  });

  it('answers completion from the owner session Shell and its live VFS after open', async () => {
    const out: OwnerToPageFrame[] = [];
    const fileSystem = new MemoryFsSync();
    const shell = new Shell({ cwd: '/workspace/packages/app', fileSystem });
    const server = createPtyServer({
      send: (frame) => out.push(frame),
      makeShell: () => shell,
    });
    server.handleFrame({ type: 'pty:open', sid: 'completion-live' });
    fileSystem.mkdirSync('/workspace/node_modules/.bin', { recursive: true });
    fileSystem.writeFileSync(
      '/workspace/node_modules/.bin/vite',
      new TextEncoder().encode('#!/usr/bin/env node\n'),
    );

    await server.handleFrame({
      type: 'pty:complete',
      sid: 'completion-live',
      opId: 'complete-live-1',
      line: 'vi',
      cursor: 2,
    });

    expect(completionResults(out)).toEqual([
      {
        type: 'pty:complete-result',
        sid: 'completion-live',
        opId: 'complete-live-1',
        ok: true,
        result: {
          start: 0,
          end: 2,
          items: [{ value: 'vite ', display: 'vite' }],
        },
      },
    ]);
  });

  it('settles client completion through the live owner and rejects its exact read failure', async () => {
    const fileSystem = new ReaddirFailingMemoryFsSync();
    const shell = new Shell({ cwd: '/workspace/packages/app', fileSystem });
    const server = createPtyServer({
      send: (frame) => client.onFrame(inspectOwnerPtyFrame(structuredClone(frame))),
      makeShell: () => shell,
    });
    const client = createPtyClient({
      send: (frame) => {
        const handled = server.handleFrame(inspectPagePtyFrame(structuredClone(frame)));
        if (handled) void handled;
      },
    });

    await client.openSession('completion-loopback');
    fileSystem.mkdirSync('/workspace/node_modules/.bin', { recursive: true });
    fileSystem.writeFileSync(
      '/workspace/node_modules/.bin/vite',
      new TextEncoder().encode('#!/usr/bin/env node\n'),
    );
    await expect(client.complete('completion-loopback', 'vi', 2)).resolves.toEqual({
      start: 0,
      end: 2,
      items: [{ value: 'vite ', display: 'vite' }],
    });

    fileSystem.failNextReaddir(new Error('loopback bare owner readdir failed exactly'));
    await expect(client.complete('completion-loopback', 'vi', 2)).rejects.toMatchObject({
      message: 'loopback bare owner readdir failed exactly',
    });

    fileSystem.failNextReaddir(new Error('loopback path-like owner readdir failed exactly'));
    await expect(client.complete('completion-loopback', './scripts/to', 12)).rejects.toMatchObject({
      message: 'loopback path-like owner readdir failed exactly',
    });
  });

  it('open → ready', () => {
    const { server, out } = harness();
    server.handleFrame({ type: 'pty:open', sid: 's1' });
    expect(out.some((f) => f.type === 'pty:ready' && f.sid === 's1')).toBe(true);
  });

  it('accepts idle session dimensions, rejects them while active, and accepts them after exit', async () => {
    const { server, out } = harness();
    server.handleFrame({ type: 'pty:open', sid: 's1' });
    server.handleFrame({
      type: 'pty:session-resize',
      sid: 's1',
      opId: 'idle-1',
      cols: 100,
      rows: 30,
    });
    expect(out).toContainEqual({
      type: 'pty:session-resize-ack',
      sid: 's1',
      opId: 'idle-1',
      ok: true,
    });

    const run = server.handleFrame({
      type: 'pty:exec',
      sid: 's1',
      rid: 'r1',
      line: 'sleep 5',
      cols: 100,
      rows: 30,
      isTTY: true,
    });
    server.handleFrame({
      type: 'pty:session-resize',
      sid: 's1',
      opId: 'idle-busy',
      cols: 120,
      rows: 40,
    });
    expect(out).toContainEqual({
      type: 'pty:session-resize-ack',
      sid: 's1',
      opId: 'idle-busy',
      ok: false,
      error: expect.stringMatching(/ProjectBusyError/),
    });

    server.handleFrame({ type: 'pty:signal', sid: 's1', rid: 'r1', signal: 'SIGINT' });
    await run;
    server.handleFrame({
      type: 'pty:session-resize',
      sid: 's1',
      opId: 'idle-2',
      cols: 132,
      rows: 43,
    });
    expect(out).toContainEqual({
      type: 'pty:session-resize-ack',
      sid: 's1',
      opId: 'idle-2',
      ok: true,
    });
  });

  it('rejects invalid and unknown idle session resize without a success ACK', () => {
    const { server, out } = harness();
    server.handleFrame({ type: 'pty:open', sid: 's1' });
    server.handleFrame({
      type: 'pty:session-resize',
      sid: 's1',
      opId: 'invalid',
      cols: 0,
      rows: 30,
    });
    server.handleFrame({
      type: 'pty:session-resize',
      sid: 'missing',
      opId: 'missing',
      cols: 100,
      rows: 30,
    });

    expect(out).toContainEqual({
      type: 'pty:session-resize-ack',
      sid: 's1',
      opId: 'invalid',
      ok: false,
      error: expect.stringMatching(/RangeError/),
    });
    expect(out).toContainEqual({
      type: 'pty:session-resize-ack',
      sid: 'missing',
      opId: 'missing',
      ok: false,
      error: expect.stringMatching(/ClosedHandleError/),
    });
  });

  it('round-trips idle resize through the real client and actor before the next exec', async () => {
    const pageFrames: PageToOwnerFrame[] = [];
    const seen: Array<{ cols: number | undefined; rows: number | undefined }> = [];
    const client = createPtyClient({ send: (frame) => pageFrames.push(frame) });
    const server = createPtyServer({
      send: (frame) => client.onFrame(frame),
      makeShell: () => {
        const shell = new Shell({ cwd: '/', env: {} });
        shell.registerCommand('capture-size', async (_args, ctx) => {
          seen.push({ cols: ctx.cols, rows: ctx.rows });
          return 0;
        });
        return shell;
      },
    });
    const opening = client.openSession('s1');
    await server.handleFrame(pageFrames.shift()!);
    await opening;
    const resized = client.resizeSession('s1', 120, 40);
    await expect(
      settledOr(
        resized.then(() => 'resolved'),
        'pending',
      ),
    ).resolves.toBe('pending');
    await server.handleFrame(pageFrames.shift()!);
    await expect(resized).resolves.toBeUndefined();

    const run = client.exec('s1', 'capture-size', {
      cols: 120,
      rows: 40,
      isTTY: true,
      onChunk: () => {},
    });
    await server.handleFrame(pageFrames.shift()!);
    await expect(run).resolves.toBe(0);
    expect(seen).toEqual([{ cols: 120, rows: 40 }]);
  });

  it('round-trips onStart only after the owner actor admits the run', async () => {
    const gate = deferred();
    const pageFrames: PageToOwnerFrame[] = [];
    const starts: string[] = [];
    const client = createPtyClient({ send: (frame) => pageFrames.push(frame) });
    const server = createPtyServer({
      send: (frame) => client.onFrame(frame),
      makeShell: () => new Shell({ cwd: '/', env: {} }),
      beforeRun: () => gate.promise,
    });

    const opening = client.openSession('s1');
    await server.handleFrame(pageFrames.shift()!);
    await opening;

    const run = client.exec('s1', 'sleep 5', {
      cols: 80,
      rows: 24,
      isTTY: true,
      onChunk: () => {},
      onStart: (rid) => starts.push(rid),
    });
    const exec = pageFrames[0] as Extract<PageToOwnerFrame, { type: 'pty:exec' }>;
    expect(exec.type).toBe('pty:exec');
    expect(starts).toEqual([]);

    const ownerRun = Promise.resolve(server.handleFrame(pageFrames.shift()!));
    expect(starts).toEqual([exec.rid]);

    client.signal('s1', exec.rid);
    await server.handleFrame(pageFrames.shift()!);
    await ownerRun;
    await expect(run).resolves.toBe(130);
  });

  it('reports no active admission while a session is idle or after its run exits', async () => {
    const { server } = harness();
    server.handleFrame({ type: 'pty:open', sid: 's1' });
    expect(server.activeAdmission('s1')).toBeNull();

    await server.handleFrame({
      type: 'pty:exec',
      sid: 's1',
      rid: 'r1',
      line: '',
      cols: 80,
      rows: 24,
      isTTY: true,
    });

    expect(server.activeAdmission('s1')).toBeNull();
  });

  it('returns the exact immutable actor-minted admission only while the PTY run is active', async () => {
    const gate = deferred();
    const server = createPtyServer({
      send: () => {},
      makeShell: () => new Shell({ cwd: '/', env: {} }),
      beforeRun: () => gate.promise,
    });
    server.handleFrame({ type: 'pty:open', sid: 's1' });
    const run = Promise.resolve(
      server.handleFrame({
        type: 'pty:exec',
        sid: 's1',
        rid: 'r1',
        line: 'echo active',
        cols: 80,
        rows: 24,
        isTTY: true,
      }),
    );
    try {
      const admission = server.activeAdmission('s1');
      expect(admission).toEqual({ ptySid: 's1', ptyRid: 'r1' });
      expect(Object.isFrozen(admission)).toBe(true);
    } finally {
      gate.resolve();
      await run;
    }
  });

  it('mints a distinct admission for each sequential run on the same session', async () => {
    const gates = [deferred(), deferred()];
    let runIndex = 0;
    const server = createPtyServer({
      send: () => {},
      makeShell: () => new Shell({ cwd: '/', env: {} }),
      beforeRun: () => gates[runIndex++]!.promise,
    });
    server.handleFrame({ type: 'pty:open', sid: 's1' });
    const firstRun = Promise.resolve(
      server.handleFrame({
        type: 'pty:exec',
        sid: 's1',
        rid: 'r1',
        line: 'echo first',
        cols: 80,
        rows: 24,
        isTTY: true,
      }),
    );
    const first = server.activeAdmission('s1');
    gates[0]!.resolve();
    await firstRun;

    const secondRun = Promise.resolve(
      server.handleFrame({
        type: 'pty:exec',
        sid: 's1',
        rid: 'r2',
        line: 'echo second',
        cols: 80,
        rows: 24,
        isTTY: true,
      }),
    );
    try {
      const second = server.activeAdmission('s1');
      expect(first).toEqual({ ptySid: 's1', ptyRid: 'r1' });
      expect(second).toEqual({ ptySid: 's1', ptyRid: 'r2' });
      expect(second).not.toBe(first);
    } finally {
      gates[1]!.resolve();
      await secondRun;
    }
  });

  it('keeps active run A admission when concurrent run B is rejected', async () => {
    const gate = deferred();
    const out: OwnerToPageFrame[] = [];
    const server = createPtyServer({
      send: (frame) => out.push(frame),
      makeShell: () => new Shell({ cwd: '/', env: {} }),
      beforeRun: () => gate.promise,
    });
    server.handleFrame({ type: 'pty:open', sid: 's1' });
    const firstRun = Promise.resolve(
      server.handleFrame({
        type: 'pty:exec',
        sid: 's1',
        rid: 'run-a',
        line: 'echo held',
        cols: 80,
        rows: 24,
        isTTY: true,
      }),
    );
    const admissionA = server.activeAdmission('s1');

    await server.handleFrame({
      type: 'pty:exec',
      sid: 's1',
      rid: 'run-b',
      line: 'echo rejected',
      cols: 80,
      rows: 24,
      isTTY: true,
    });

    expect(server.activeAdmission('s1')).toBe(admissionA);
    expect(server.activeAdmission('s1')).toEqual({ ptySid: 's1', ptyRid: 'run-a' });
    expect(out).toContainEqual(
      expect.objectContaining({
        type: 'pty:exit',
        sid: 's1',
        rid: 'run-b',
        error: expect.stringMatching(/already running run-a/),
      }),
    );

    gate.resolve();
    await firstRun;
    expect(server.activeAdmission('s1')).toBeNull();
  });

  it('corrupt-input fault: duplicate active rid cannot emit a false exit for run A', async () => {
    const gate = deferred();
    const out: OwnerToPageFrame[] = [];
    const server = createPtyServer({
      send: (frame) => out.push(frame),
      makeShell: () => new Shell({ cwd: '/', env: {} }),
      beforeRun: () => gate.promise,
    });
    server.handleFrame({ type: 'pty:open', sid: 's1' });
    const frame = {
      type: 'pty:exec' as const,
      sid: 's1',
      rid: 'run-a',
      line: 'echo held',
      cols: 80,
      rows: 24,
      isTTY: true,
    };
    const firstRun = Promise.resolve(server.handleFrame(frame));
    const admissionA = server.activeAdmission('s1');

    expect(() => server.handleFrame({ ...frame, line: 'echo duplicate' })).toThrow(
      /ProtocolError: duplicate active PTY run id s1\/run-a/,
    );
    expect(server.activeAdmission('s1')).toBe(admissionA);
    expect(
      out.filter((candidate) => candidate.type === 'pty:exit' && candidate.rid === 'run-a'),
    ).toEqual([]);

    gate.resolve();
    await firstRun;
    expect(
      out.filter((candidate) => candidate.type === 'pty:exit' && candidate.rid === 'run-a'),
    ).toHaveLength(1);
  });

  it('round-trips session close before page admission through the real client and actor', async () => {
    const gate = deferred();
    const pageFrames: PageToOwnerFrame[] = [];
    const ownerFrames: OwnerToPageFrame[] = [];
    const starts: string[] = [];
    const client = createPtyClient({ send: (frame) => pageFrames.push(frame) });
    const server = createPtyServer({
      send: (frame) => ownerFrames.push(frame),
      makeShell: () => new Shell({ cwd: '/', env: {} }),
      beforeRun: () => gate.promise,
    });

    const opening = client.openSession('s1');
    await server.handleFrame(pageFrames.shift()!);
    client.onFrame(ownerFrames.shift()!);
    await opening;

    const run = client.execResult('s1', 'node pending.mjs', {
      cols: 80,
      rows: 24,
      isTTY: true,
      onChunk: () => {},
      onStart: (rid) => starts.push(rid),
    });
    const exec = pageFrames.shift()!;
    expect(exec.type).toBe('pty:exec');
    const ownerRun = Promise.resolve(server.handleFrame(exec));
    await Promise.resolve();
    expect(ownerFrames.map((frame) => frame.type)).toEqual(['pty:run-ready']);

    const closing = client.closeSession('s1');
    const ownerClose = Promise.resolve(server.handleFrame(pageFrames.shift()!));
    await Promise.all([ownerRun, ownerClose]);
    expect(ownerFrames.map((frame) => frame.type)).toEqual([
      'pty:run-ready',
      'pty:exit',
      'pty:close-ack',
    ]);
    for (const frame of ownerFrames) client.onFrame(frame);

    expect(starts).toEqual([]);
    await expect(run).resolves.toEqual({
      exitCode: 130,
      exit: { code: null, signal: 'SIGINT' },
    });
    await expect(closing).resolves.toBeUndefined();
    gate.resolve();
  });

  it('claims one run synchronously before an awaited gate', async () => {
    const gate = deferred();
    const out: OwnerToPageFrame[] = [];
    let gateCalls = 0;
    const server = createPtyServer({
      send: (frame) => out.push(frame),
      makeShell: () => new Shell({ cwd: '/', env: {} }),
      beforeRun: () => {
        gateCalls += 1;
        return gate.promise;
      },
    });
    server.handleFrame({ type: 'pty:open', sid: 's1' });

    const first = server.handleFrame({
      type: 'pty:exec',
      sid: 's1',
      rid: 'r1',
      line: 'echo first',
      cols: 80,
      rows: 24,
      isTTY: true,
    });
    const second = server.handleFrame({
      type: 'pty:exec',
      sid: 's1',
      rid: 'r2',
      line: 'echo second',
      cols: 80,
      rows: 24,
      isTTY: true,
    });
    await Promise.resolve();

    expect(gateCalls).toBe(1);
    expect(out).toContainEqual({ type: 'pty:run-ready', sid: 's1', rid: 'r1' });
    expect(out.some((frame) => frame.type === 'pty:run-ready' && frame.rid === 'r2')).toBe(false);
    expect(out).toContainEqual(
      expect.objectContaining({ type: 'pty:exit', sid: 's1', rid: 'r2', code: 1 }),
    );

    gate.resolve();
    await Promise.all([first, second]);
    const firstExit = out.find((frame) => frame.type === 'pty:exit' && frame.rid === 'r1');
    expect(firstExit && firstExit.type === 'pty:exit' && firstExit.code).toBe(0);
  });

  it('latches the latest pre-run resize, applies live resize in order, and rejects stale rid', async () => {
    const gate = deferred();
    const started = deferred();
    const finish = deferred();
    const initial: Array<{ cols: number | undefined; rows: number | undefined }> = [];
    const live: Array<{ cols: number; rows: number }> = [];
    const out: OwnerToPageFrame[] = [];
    const server = createPtyServer({
      send: (frame) => out.push(frame),
      makeShell: () => {
        const shell = new Shell({ cwd: '/', env: {} });
        shell.registerCommand('watch-size', async (_args, ctx) => {
          initial.push({ cols: ctx.cols, rows: ctx.rows });
          const terminal = (
            ctx as typeof ctx & {
              readonly terminal?: {
                subscribe(listener: (size: { cols: number; rows: number }) => void): () => void;
              };
            }
          ).terminal;
          const unsubscribe = terminal?.subscribe((size) => live.push(size));
          started.resolve();
          await finish.promise;
          unsubscribe?.();
          return 0;
        });
        return shell;
      },
      beforeRun: () => gate.promise,
    });
    server.handleFrame({ type: 'pty:open', sid: 's1' });
    const run = server.handleFrame({
      type: 'pty:exec',
      sid: 's1',
      rid: 'r1',
      line: 'watch-size',
      cols: 80,
      rows: 24,
      isTTY: true,
    });

    await server.handleFrame({
      type: 'pty:resize',
      sid: 's1',
      rid: 'r1',
      opId: 'resize-1',
      cols: 100,
      rows: 30,
    } as never);
    await server.handleFrame({
      type: 'pty:resize',
      sid: 's1',
      rid: 'r1',
      opId: 'resize-2',
      cols: 132,
      rows: 43,
    } as never);
    gate.resolve();
    await started.promise;

    expect(initial).toEqual([{ cols: 132, rows: 43 }]);
    expect(
      out
        .filter(
          (frame): frame is Extract<OwnerToPageFrame, { type: 'pty:resize-ack' }> =>
            frame.type === 'pty:resize-ack',
        )
        .map((frame) => ({ opId: frame.opId, ok: frame.ok })),
    ).toEqual([
      { opId: 'resize-1', ok: true },
      { opId: 'resize-2', ok: true },
    ]);

    await server.handleFrame({
      type: 'pty:resize',
      sid: 's1',
      rid: 'stale-rid',
      opId: 'resize-stale',
      cols: 10,
      rows: 10,
    } as never);
    await server.handleFrame({
      type: 'pty:resize',
      sid: 's1',
      rid: 'r1',
      opId: 'resize-live',
      cols: 140,
      rows: 50,
    } as never);
    expect(live).toEqual([{ cols: 140, rows: 50 }]);
    expect(out).toContainEqual(
      expect.objectContaining({
        type: 'pty:resize-ack',
        opId: 'resize-stale',
        ok: false,
      }),
    );

    finish.resolve();
    await run;
  });

  it('returns a negative resize ACK when the supervised dev-child resize control closes', async () => {
    const out: OwnerToPageFrame[] = [];
    const child = new ResizeRejectingDevChild();
    const spawned = deferred();
    const started = deferred();
    const driver = createOwnerChildDevServer(
      'blob:dev-worker',
      {
        kernelWorkerUrl: 'blob:kernel-worker',
        nodeEntryWorkerUrl: 'blob:node-worker',
        sqliteWasmUrl: 'blob:sqlite-wasm',
      },
      reserveEmptyAdmission,
      () => {
        spawned.resolve();
        return child;
      },
    );
    const server = createPtyServer({
      send: (frame) => out.push(frame),
      makeShell: () => {
        const shell = new Shell({ cwd: '/', env: {} });
        shell.registerCommand('dev-resize-fault', async (_args, ctx) => {
          const handle = await driver.boot({
            signal: ctx.signal ?? new AbortController().signal,
            log: (chunk) => ctx.stdout.write(chunk),
            params: {
              env: { ...ctx.env },
              cfg: {
                runtime: 'node-server',
                root: '/workspace',
                port: 5174,
                entryPath: '/workspace/server.mjs',
                packageName: 'node-server',
                packageVersion: '1.0.0',
                installDeps: {},
                packageJson: '{"name":"node-server","version":"1.0.0"}\n',
                seedFiles: {},
              },
              isTTY: ctx.isTTY,
              cols: ctx.cols,
              rows: ctx.rows,
              terminal: ctx.terminal,
            },
            onSnapshotDirty: () => {},
          });
          started.resolve();
          throw (await handle.failure).error;
        });
        return shell;
      },
    });
    server.handleFrame({ type: 'pty:open', sid: 's1' });
    const run = Promise.resolve(
      server.handleFrame({
        type: 'pty:exec',
        sid: 's1',
        rid: 'r1',
        line: 'dev-resize-fault',
        cols: 80,
        rows: 24,
        isTTY: true,
      }),
    );
    expect(
      await settledOr(
        spawned.promise.then(() => 'spawned' as const),
        'pending',
      ),
    ).toBe('spawned');
    child.emit('message', { type: 'rifty:dev-ready', port: 5174 });
    expect(
      await settledOr(
        started.promise.then(() => 'started' as const),
        'pending',
      ),
    ).toBe('started');
    child.rejectResize = true;

    let ackError: unknown;
    try {
      server.handleFrame({
        type: 'pty:resize',
        sid: 's1',
        rid: 'r1',
        opId: 'resize-dev-fault',
        cols: 120,
        rows: 40,
      });

      expect(out).toContainEqual({
        type: 'pty:resize-ack',
        sid: 's1',
        rid: 'r1',
        opId: 'resize-dev-fault',
        ok: false,
        error: 'foreground child resize control is closed',
      });
    } catch (error) {
      ackError = error;
    } finally {
      server.handleFrame({ type: 'pty:signal', sid: 's1', rid: 'r1', signal: 'SIGINT' });
    }
    if (ackError !== undefined) {
      void run.catch(() => undefined);
      throw ackError;
    }
    await run;
  });

  it('returns a negative resize ACK when the foreground Node/.bin control closes', async () => {
    const out: OwnerToPageFrame[] = [];
    const started = deferred();
    let rejectResize = false;
    let emitChildExit = (_code: number | null, _signal: 'SIGTERM' | null): void => {
      throw new Error('foreground child exit listener was not registered');
    };
    const kill = vi.fn(() => true);
    const child: ForegroundChildHandle = {
      stdout: () => ({ on: () => undefined }),
      stderr: () => ({ on: () => undefined }),
      stdin: () => ({
        write: (_chunk, callback) => callback(),
        end: () => undefined,
        once: () => undefined,
        removeListener: () => undefined,
      }),
      on(event, listener) {
        if (event === 'exit') {
          const exitListener = listener as (code?: unknown, signal?: unknown) => void;
          emitChildExit = (code, signal) => exitListener(code, signal);
        }
      },
      resize: () => !rejectResize,
      kill,
    };
    const server = createPtyServer({
      send: (frame) => out.push(frame),
      makeShell: () => {
        const shell = new Shell({ cwd: '/', env: {} });
        shell.registerCommand('foreground-resize-fault', (_args, ctx) => {
          const run = runForegroundChild(child, ctx);
          started.resolve();
          return run;
        });
        return shell;
      },
    });
    server.handleFrame({ type: 'pty:open', sid: 's1' });
    const run = Promise.resolve(
      server.handleFrame({
        type: 'pty:exec',
        sid: 's1',
        rid: 'r1',
        line: 'foreground-resize-fault',
        cols: 80,
        rows: 24,
        isTTY: true,
      }),
    );
    await started.promise;
    rejectResize = true;

    server.handleFrame({
      type: 'pty:resize',
      sid: 's1',
      rid: 'r1',
      opId: 'resize-foreground-fault',
      cols: 120,
      rows: 40,
    });

    expect(out).toContainEqual({
      type: 'pty:resize-ack',
      sid: 's1',
      rid: 'r1',
      opId: 'resize-foreground-fault',
      ok: false,
      error: 'foreground child resize control is closed',
    });
    expect(kill).toHaveBeenCalledWith('SIGTERM');
    expect(
      await settledOr(
        run.then(() => 'settled' as const),
        'pending',
      ),
    ).toBe('pending');
    emitChildExit(null, 'SIGTERM');
    await run;
  });

  it('awaits one session close without disturbing a sibling run', async () => {
    const out: OwnerToPageFrame[] = [];
    const server = createPtyServer({
      send: (frame) => out.push(frame),
      makeShell: () => new Shell({ cwd: '/', env: {} }),
    });
    server.handleFrame({ type: 'pty:open', sid: 's1' });
    server.handleFrame({ type: 'pty:open', sid: 's2' });
    const first = server.handleFrame({
      type: 'pty:exec',
      sid: 's1',
      rid: 'r1',
      line: 'sleep 5',
      cols: 80,
      rows: 24,
      isTTY: true,
    });
    const second = server.handleFrame({
      type: 'pty:exec',
      sid: 's2',
      rid: 'r2',
      line: 'sleep 5',
      cols: 80,
      rows: 24,
      isTTY: true,
    });
    await Promise.resolve();

    const close = server.handleFrame({ type: 'pty:close', sid: 's1', opId: 'close-1' } as never);
    expect(out.some((frame) => frame.type === 'pty:close-ack')).toBe(false);
    await close;
    expect(out).toContainEqual(expect.objectContaining({ type: 'pty:exit', rid: 'r1', code: 130 }));
    expect(out).toContainEqual({
      type: 'pty:close-ack',
      sid: 's1',
      opId: 'close-1',
      ok: true,
    });
    expect(out.some((frame) => frame.type === 'pty:exit' && frame.rid === 'r2')).toBe(false);

    server.handleFrame({ type: 'pty:signal', sid: 's2', rid: 'r2', signal: 'SIGINT' });
    await Promise.all([first, second]);
    expect(out).toContainEqual(expect.objectContaining({ type: 'pty:exit', rid: 'r2', code: 130 }));
  });

  it('does not emit pty:exit or close ACK until the killed foreground child physically exits', async () => {
    const out: OwnerToPageFrame[] = [];
    const started = deferred();
    let emitChildExit = (_code: number | null, _signal: 'SIGINT' | 'SIGTERM' | null): void => {
      throw new Error('foreground child exit listener was not registered');
    };
    const kill = vi.fn((_signal?: string) => true);
    const server = createPtyServer({
      send: (frame) => out.push(frame),
      makeShell: () => {
        const shell = new Shell({ cwd: '/', env: {} });
        shell.registerCommand('foreground-child', (_args, ctx) => {
          const child: ForegroundChildHandle = {
            stdout: () => ({ on: () => undefined }),
            stderr: () => ({ on: () => undefined }),
            stdin: () => ({
              write: (_chunk, callback) => callback(),
              end: () => undefined,
              once: () => undefined,
              removeListener: () => undefined,
            }),
            on(event, listener) {
              if (event === 'exit') {
                const exitListener = listener as (code?: unknown, signal?: unknown) => void;
                emitChildExit = (code, signal) => exitListener(code, signal);
              }
            },
            resize: () => true,
            kill,
          };
          started.resolve();
          return runForegroundChild(child, ctx);
        });
        return shell;
      },
    });
    server.handleFrame({ type: 'pty:open', sid: 's1' });
    const run = server.handleFrame({
      type: 'pty:exec',
      sid: 's1',
      rid: 'r1',
      line: 'foreground-child',
      cols: 80,
      rows: 24,
      isTTY: true,
    });
    await started.promise;

    const close = Promise.resolve(
      server.handleFrame({ type: 'pty:close', sid: 's1', opId: 'close-physical' }),
    );
    await vi.waitFor(() => expect(kill).toHaveBeenCalledWith('SIGTERM'));
    const beforePhysicalExit = await settledOr(
      close.then(() => 'settled' as const),
      'pending',
    );

    emitChildExit(null, 'SIGTERM');
    await Promise.all([run, close]);
    const exitIndex = out.findIndex((frame) => frame.type === 'pty:exit' && frame.rid === 'r1');
    const closeIndex = out.findIndex(
      (frame) => frame.type === 'pty:close-ack' && frame.opId === 'close-physical',
    );
    expect(beforePhysicalExit).toBe('pending');
    expect(exitIndex).toBeGreaterThan(-1);
    expect(closeIndex).toBeGreaterThan(exitIndex);
    expect(out[exitIndex]).toMatchObject({
      code: 130,
      exit: { code: null, signal: 'SIGTERM' },
    });
  });

  it('server close fences late frames and awaits every real shell background child', async () => {
    const out: OwnerToPageFrame[] = [];
    const made: string[] = [];
    const aborted: string[] = [];
    const started = new Map([
      ['z-session', deferred()],
      ['a-session', deferred()],
    ]);
    const physicalExit = new Map([
      ['z-session', deferred()],
      ['a-session', deferred()],
    ]);
    const onDevConfig = vi.fn();
    const server = createPtyServer({
      send: (frame) => out.push(frame),
      makeShell: (_seed, sid) => {
        made.push(sid);
        const shell = new Shell({ cwd: '/', env: {} });
        shell.registerCommand('held-child', async (_args, ctx) => {
          ctx.signal?.addEventListener(
            'abort',
            () => {
              aborted.push(sid);
            },
            { once: true },
          );
          started.get(sid)?.resolve();
          await physicalExit.get(sid)?.promise;
          return 143;
        });
        return shell;
      },
      onDevConfig,
    });
    server.handleFrame({ type: 'pty:open', sid: 'z-session' });
    server.handleFrame({ type: 'pty:open', sid: 'a-session' });
    await Promise.all([
      server.handleFrame({
        type: 'pty:exec',
        sid: 'z-session',
        rid: 'run-z',
        line: 'held-child &',
        cols: 80,
        rows: 24,
        isTTY: true,
      }),
      server.handleFrame({
        type: 'pty:exec',
        sid: 'a-session',
        rid: 'run-a',
        line: 'held-child &',
        cols: 80,
        rows: 24,
        isTTY: true,
      }),
    ]);
    await Promise.all([...started.values()].map((gate) => gate.promise));

    const closing = server.close();
    expect(server.close()).toBe(closing);
    expect(server.dispose()).toBe(closing);
    server.handleFrame({ type: 'pty:open', sid: 'late-session' });
    server.handleFrame({
      type: 'pty:exec',
      sid: 'late-session',
      rid: 'late-run',
      line: 'echo too-late',
      cols: 80,
      rows: 24,
      isTTY: true,
    });
    server.handleFrame({
      type: 'pty:dev-config',
      id: 'late-config',
      templateId: 'typescript',
      slug: 'late',
      setup: 'instant',
    });

    await vi.waitFor(() => expect(new Set(aborted)).toEqual(new Set(['a-session', 'z-session'])));
    expect(
      await settledOr(
        closing.then(() => 'settled' as const),
        'pending',
      ),
    ).toBe('pending');
    expect(made).toEqual(['z-session', 'a-session']);
    expect(onDevConfig).not.toHaveBeenCalled();
    expect(out).toContainEqual({
      type: 'pty:ready',
      sid: 'late-session',
      error: expect.stringMatching(/ClosedHandleError.*server.*closing/i),
    });
    expect(out).toContainEqual(
      expect.objectContaining({
        type: 'pty:exit',
        sid: 'late-session',
        rid: 'late-run',
        code: 1,
        error: expect.stringMatching(/ClosedHandleError.*server.*closing/i),
      }),
    );
    expect(out).toContainEqual({
      type: 'pty:dev-config-ready',
      id: 'late-config',
      error: expect.stringMatching(/ClosedHandleError.*server.*closing/i),
    });

    physicalExit.get('z-session')?.resolve();
    expect(
      await settledOr(
        closing.then(() => 'settled' as const),
        'pending',
      ),
    ).toBe('pending');
    physicalExit.get('a-session')?.resolve();
    await closing;

    server.handleFrame({ type: 'pty:open', sid: 'after-close' });
    expect(made).toEqual(['z-session', 'a-session']);
    expect(out).toContainEqual({
      type: 'pty:ready',
      sid: 'after-close',
      error: expect.stringMatching(/ClosedHandleError.*server.*closed/i),
    });
  });

  it('server close aggregates every actor failure in stable session-id order', async () => {
    const aborted: string[] = [];
    const started = new Map([
      ['z-session', deferred()],
      ['a-session', deferred()],
    ]);
    const physicalExit = new Map([
      ['z-session', deferred()],
      ['a-session', deferred()],
    ]);
    const server = createPtyServer({
      send: (frame) => {
        if (frame.type === 'pty:exit' && frame.rid.startsWith('run-')) {
          throw new Error(`transport exit failed for ${frame.sid}`);
        }
      },
      makeShell: (_seed, sid) => {
        const shell = new Shell({ cwd: '/', env: {} });
        shell.registerCommand('held-child', async (_args, ctx) => {
          ctx.signal?.addEventListener(
            'abort',
            () => {
              aborted.push(sid);
            },
            { once: true },
          );
          started.get(sid)?.resolve();
          await physicalExit.get(sid)?.promise;
          return 143;
        });
        return shell;
      },
    });
    server.handleFrame({ type: 'pty:open', sid: 'z-session' });
    server.handleFrame({ type: 'pty:open', sid: 'a-session' });
    await Promise.all([
      server.handleFrame({
        type: 'pty:exec',
        sid: 'z-session',
        rid: 'bg-z',
        line: 'held-child &',
        cols: 80,
        rows: 24,
        isTTY: true,
      }),
      server.handleFrame({
        type: 'pty:exec',
        sid: 'a-session',
        rid: 'bg-a',
        line: 'held-child &',
        cols: 80,
        rows: 24,
        isTTY: true,
      }),
    ]);
    await Promise.all([...started.values()].map((gate) => gate.promise));
    const runZ = server.handleFrame({
      type: 'pty:exec',
      sid: 'z-session',
      rid: 'run-z',
      line: 'sleep 5',
      cols: 80,
      rows: 24,
      isTTY: true,
    });
    const runA = server.handleFrame({
      type: 'pty:exec',
      sid: 'a-session',
      rid: 'run-a',
      line: 'sleep 5',
      cols: 80,
      rows: 24,
      isTTY: true,
    });
    await Promise.resolve();

    const closing = server.close();
    expect(server.dispose()).toBe(closing);
    await vi.waitFor(() => expect(new Set(aborted)).toEqual(new Set(['a-session', 'z-session'])));
    expect(
      await settledOr(
        closing.then(() => 'settled' as const),
        'pending',
      ),
    ).toBe('pending');
    physicalExit.get('z-session')?.resolve();
    expect(
      await settledOr(
        closing.then(() => 'settled' as const),
        'pending',
      ),
    ).toBe('pending');
    physicalExit.get('a-session')?.resolve();
    const failure = await closing.then(
      () => undefined,
      (error: unknown) => error,
    );
    await Promise.allSettled([runZ, runA]);

    expect(failure).toBeInstanceOf(AggregateError);
    const errors = (failure as { readonly errors: readonly unknown[] }).errors;
    expect(errors.map((error) => (error instanceof Error ? error.message : String(error)))).toEqual(
      [
        'pty session a-session: transport exit failed for a-session',
        'pty session z-session: transport exit failed for z-session',
      ],
    );
  });

  it('rejects pty:open loudly while the session actor is closing', async () => {
    const { server, out } = harness();
    server.handleFrame({ type: 'pty:open', sid: 's1' });
    const run = server.handleFrame({
      type: 'pty:exec',
      sid: 's1',
      rid: 'r1',
      line: 'sleep 5',
      cols: 80,
      rows: 24,
      isTTY: true,
    });
    await Promise.resolve();
    out.length = 0;

    const close = server.handleFrame({ type: 'pty:close', sid: 's1', opId: 'close-1' });
    server.handleFrame({ type: 'pty:open', sid: 's1' });
    const reopen = out.find((frame) => frame.type === 'pty:ready');

    await Promise.all([run, close]);
    expect(reopen).toEqual({
      type: 'pty:ready',
      sid: 's1',
      error: expect.stringMatching(/ClosedHandleError.*closing/i),
    });
  });

  it('never acknowledges a run rejected while the session actor is closing', async () => {
    const gate = deferred();
    const out: OwnerToPageFrame[] = [];
    const server = createPtyServer({
      send: (frame) => out.push(frame),
      makeShell: () => new Shell({ cwd: '/', env: {} }),
      beforeRun: () => gate.promise,
    });
    server.handleFrame({ type: 'pty:open', sid: 's1' });
    const first = server.handleFrame({
      type: 'pty:exec',
      sid: 's1',
      rid: 'r1',
      line: 'echo first',
      cols: 80,
      rows: 24,
      isTTY: true,
    });
    const close = server.handleFrame({ type: 'pty:close', sid: 's1', opId: 'close-1' });
    server.handleFrame({
      type: 'pty:session-resize',
      sid: 's1',
      opId: 'resize-closing',
      cols: 100,
      rows: 30,
    });
    const rejected = server.handleFrame({
      type: 'pty:exec',
      sid: 's1',
      rid: 'r2',
      line: 'echo too-late',
      cols: 80,
      rows: 24,
      isTTY: true,
    });

    await Promise.all([first, close, rejected]);
    expect(out).toContainEqual({ type: 'pty:run-ready', sid: 's1', rid: 'r1' });
    expect(out.some((frame) => frame.type === 'pty:run-ready' && frame.rid === 'r2')).toBe(false);
    expect(out).toContainEqual({
      type: 'pty:session-resize-ack',
      sid: 's1',
      opId: 'resize-closing',
      ok: false,
      error: expect.stringMatching(/ClosedHandleError/),
    });
    expect(out).toContainEqual(
      expect.objectContaining({ type: 'pty:exit', sid: 's1', rid: 'r2', code: 1 }),
    );
  });

  it('exec echo streams chunk(s) BEFORE exit (no reorder)', async () => {
    const { server, out } = harness();
    server.handleFrame({ type: 'pty:open', sid: 's1' });
    await server.handleFrame({
      type: 'pty:exec',
      sid: 's1',
      rid: 'r1',
      line: 'echo hi',
      cols: 80,
      rows: 24,
      isTTY: true,
    });
    const types = out.map((f) => f.type);
    const firstExit = types.indexOf('pty:exit');
    const lastChunk = types.lastIndexOf('pty:chunk');
    expect(firstExit).toBeGreaterThan(-1);
    expect(lastChunk).toBeLessThan(firstExit); // every chunk precedes exit
    const exit = out.find((f) => f.type === 'pty:exit');
    expect(exit && exit.type === 'pty:exit' && exit.code).toBe(0);
  });

  it('pty:exit carries cwd mutated by cd', async () => {
    const { server, out } = harness();
    server.handleFrame({ type: 'pty:open', sid: 's1' });
    await server.handleFrame({
      type: 'pty:exec',
      sid: 's1',
      rid: 'r1',
      line: 'mkdir -p /work && cd /work',
      cols: 80,
      rows: 24,
      isTTY: true,
    });
    const exit = out.find((f) => f.type === 'pty:exit' && f.rid === 'r1');
    expect(exit && exit.type === 'pty:exit' && exit.cwd).toBe('/work');
  });

  it('SIGINT aborts the run → exit 130', async () => {
    const { server, out } = harness();
    server.handleFrame({ type: 'pty:open', sid: 's1' });
    const run = server.handleFrame({
      type: 'pty:exec',
      sid: 's1',
      rid: 'r1',
      line: 'sleep 5',
      cols: 80,
      rows: 24,
      isTTY: true,
    });
    server.handleFrame({ type: 'pty:signal', sid: 's1', rid: 'r1', signal: 'SIGINT' });
    await run;
    const exit = out.find((f) => f.type === 'pty:exit' && f.rid === 'r1');
    expect(exit && exit.type === 'pty:exit' && exit.code).toBe(130);
  });

  it('pty:exit carries env mutated by an inline assignment run', async () => {
    const { server, out } = harness();
    server.handleFrame({ type: 'pty:open', sid: 's1' });
    await server.handleFrame({
      type: 'pty:exec',
      sid: 's1',
      rid: 'r1',
      line: 'FOO=bar',
      cols: 80,
      rows: 24,
      isTTY: true,
    });
    const exit = out.find((f) => f.type === 'pty:exit' && f.rid === 'r1');
    expect(exit && exit.type === 'pty:exit' && exit.env.FOO).toBe('bar');
  });

  it('pty:open seed makes the session shell start at the restored cwd/env (reload restore)', async () => {
    const out: OwnerToPageFrame[] = [];
    const server = createPtyServer({
      send: (f) => out.push(f),
      makeShell: (seed) => new Shell({ cwd: seed?.cwd ?? '/', env: seed?.env ?? {} }),
    });
    server.handleFrame({ type: 'pty:open', sid: 's1', cwd: '/work', env: { FOO: 'bar' } });
    await server.handleFrame({
      type: 'pty:exec',
      sid: 's1',
      rid: 'r1',
      line: 'echo seeded',
      cols: 80,
      rows: 24,
      isTTY: true,
    });
    const exit = out.find((f) => f.type === 'pty:exit' && f.rid === 'r1');
    expect(exit && exit.type === 'pty:exit' && exit.cwd).toBe('/work');
    expect(exit && exit.type === 'pty:exit' && exit.env.FOO).toBe('bar');
  });

  it('passes the pty session id to the shell factory', () => {
    const seen: string[] = [];
    const server = createPtyServer({
      send: () => {},
      makeShell: (_seed, sid) => {
        seen.push(sid);
        return new Shell({ cwd: '/', env: {} });
      },
    });
    server.handleFrame({ type: 'pty:open', sid: 'terminal-9' });
    expect(seen).toEqual(['terminal-9']);
  });

  it('round-trips guest env keys that resemble former internal PTY metadata', async () => {
    const out: OwnerToPageFrame[] = [];
    const server = createPtyServer({
      send: (f) => out.push(f),
      makeShell: () => new Shell({ cwd: '/', env: { RIFTY_INTERNAL_PTY_SID: 'terminal-1' } }),
    });
    server.handleFrame({ type: 'pty:open', sid: 'terminal-1' });
    await server.handleFrame({
      type: 'pty:exec',
      sid: 'terminal-1',
      rid: 'r1',
      line: 'echo hi',
      cols: 80,
      rows: 24,
      isTTY: true,
    });
    const exit = out.find((f) => f.type === 'pty:exit' && f.rid === 'r1');
    expect(exit && exit.type === 'pty:exit' && exit.env.RIFTY_INTERNAL_PTY_SID).toBe('terminal-1');
  });

  it('exec on an unknown session emits pty:exit{error} instead of silently hanging the page run', async () => {
    const { server, out } = harness();
    // No pty:open for this sid (protocol-order violation / owner restarted).
    await server.handleFrame({
      type: 'pty:exec',
      sid: 's-missing',
      rid: 'r1',
      line: 'echo hi',
      cols: 80,
      rows: 24,
      isTTY: true,
    });
    const exit = out.find((f) => f.type === 'pty:exit' && f.rid === 'r1');
    expect(exit && exit.type === 'pty:exit').toBeTruthy();
    expect(exit && exit.type === 'pty:exit' && exit.code).not.toBe(0);
    expect(exit && exit.type === 'pty:exit' && exit.error).toBeTruthy();
    expect(out.some((frame) => frame.type === 'pty:run-ready' && frame.rid === 'r1')).toBe(false);
  });

  it('routes pty:dev-server-req to onDevServerReq (ADR-0148)', () => {
    let reqs = 0;
    const server = createPtyServer({
      send: () => {},
      makeShell: () => new Shell({ cwd: '/', env: {} }),
      onDevServerReq: () => {
        reqs++;
      },
    });
    server.handleFrame({ type: 'pty:dev-server-req' });
    expect(reqs).toBe(1);
  });

  it('forwards pty:preview-req to onPreviewReq', () => {
    const onPreviewReq = vi.fn();
    const server = createPtyServer({
      send: () => {},
      makeShell: () => new Shell({ cwd: '/', env: {} }),
      onPreviewReq,
    });
    server.handleFrame({ type: 'pty:preview-req' });
    expect(onPreviewReq).toHaveBeenCalledOnce();
  });

  it('routes pty:dev-config to onDevConfig (ADR-0148 owner-resident dev server preset switch)', () => {
    const configs: unknown[] = [];
    const server = createPtyServer({
      send: () => {},
      makeShell: () => new Shell({ cwd: '/', env: {} }),
      onDevConfig: (c) => {
        configs.push(c);
      },
    });
    server.handleFrame({
      type: 'pty:dev-config',
      id: 'dc1',
      templateId: 'express-sqlite',
      slug: 'fullstack',
      setup: 'from-scratch',
    });
    expect(configs).toEqual([
      { templateId: 'express-sqlite', slug: 'fullstack', setup: 'from-scratch' },
    ]);
  });

  it('acks pty:dev-config only after async dependency preparation settles', async () => {
    const ready = deferred();
    const out: OwnerToPageFrame[] = [];
    const server = createPtyServer({
      send: (f) => out.push(f),
      makeShell: () => new Shell({ cwd: '/', env: {} }),
      onDevConfig: () => ready.promise,
    });
    const run = server.handleFrame({
      type: 'pty:dev-config',
      id: 'dc1',
      templateId: 'typescript',
      slug: 'scratch',
      setup: 'instant',
    });
    expect(out).toEqual([]);
    ready.resolve();
    await run;
    expect(out).toEqual([{ type: 'pty:dev-config-ready', id: 'dc1' }]);
  });

  describe('beforeExit state-publication barrier', () => {
    it('keeps the run active and emits its exit only after the published-state marker', async () => {
      const barrier = deferred();
      const entered = deferred();
      const out: OwnerToPageFrame[] = [];
      const timeline: string[] = [];
      const server = createPtyServer({
        send: (frame) => {
          out.push(frame);
          if (frame.type === 'pty:exit') timeline.push(`exit:${frame.rid}`);
        },
        makeShell: () => new Shell({ cwd: '/', env: {} }),
        beforeExit: async () => {
          timeline.push('barrier-entered');
          entered.resolve();
          await barrier.promise;
          timeline.push('state-published');
        },
      });
      server.handleFrame({ type: 'pty:open', sid: 's1' });
      const first = Promise.resolve(
        server.handleFrame({
          type: 'pty:exec',
          sid: 's1',
          rid: 'r1',
          line: 'echo first',
          cols: 80,
          rows: 24,
          isTTY: true,
        }),
      );
      await entered.promise;

      expect(server.activeAdmission('s1')).toEqual({ ptySid: 's1', ptyRid: 'r1' });
      await expect(
        settledOr(
          first.then(() => 'settled'),
          'pending',
        ),
      ).resolves.toBe('pending');
      expect(out.some((frame) => frame.type === 'pty:exit' && frame.rid === 'r1')).toBe(false);

      await server.handleFrame({
        type: 'pty:exec',
        sid: 's1',
        rid: 'r2',
        line: 'echo second',
        cols: 80,
        rows: 24,
        isTTY: true,
      });
      expect(server.activeAdmission('s1')).toEqual({ ptySid: 's1', ptyRid: 'r1' });
      expect(out).toContainEqual(
        expect.objectContaining({
          type: 'pty:exit',
          sid: 's1',
          rid: 'r2',
          error: expect.stringMatching(/ProjectBusyError.*r1/),
        }),
      );
      expect(timeline).toEqual(['barrier-entered', 'exit:r2']);

      barrier.resolve();
      await expect(first).resolves.toBeUndefined();
      expect(timeline).toEqual(['barrier-entered', 'exit:r2', 'state-published', 'exit:r1']);
      expect(server.activeAdmission('s1')).toBeNull();
    });

    it('rejects the exec and releases the run without an exit when publication fails', async () => {
      const entered = deferred();
      let rejectBarrier!: (reason: Error) => void;
      const barrier = new Promise<void>((_resolve, reject) => {
        rejectBarrier = reject;
      });
      const out: OwnerToPageFrame[] = [];
      let barrierCalls = 0;
      const server = createPtyServer({
        send: (frame) => out.push(frame),
        makeShell: () => new Shell({ cwd: '/', env: {} }),
        beforeExit: () => {
          barrierCalls += 1;
          if (barrierCalls !== 1) return;
          entered.resolve();
          return barrier;
        },
      });
      server.handleFrame({ type: 'pty:open', sid: 's1' });
      const first = Promise.resolve(
        server.handleFrame({
          type: 'pty:exec',
          sid: 's1',
          rid: 'r1',
          line: 'echo first',
          cols: 80,
          rows: 24,
          isTTY: true,
        }),
      );
      await entered.promise;

      const failure = new Error('project state publication failed');
      rejectBarrier(failure);
      await expect(first).rejects.toBe(failure);
      expect(server.activeAdmission('s1')).toBeNull();
      expect(out.some((frame) => frame.type === 'pty:exit' && frame.rid === 'r1')).toBe(false);

      await expect(
        Promise.resolve(
          server.handleFrame({
            type: 'pty:exec',
            sid: 's1',
            rid: 'r2',
            line: 'echo recovered',
            cols: 80,
            rows: 24,
            isTTY: true,
          }),
        ),
      ).resolves.toBeUndefined();
      expect(out).toContainEqual(
        expect.objectContaining({ type: 'pty:exit', sid: 's1', rid: 'r2', code: 0 }),
      );
    });
  });

  describe('beforeRun gate (deps restore overlaps the echoed command)', () => {
    const dec = new TextDecoder();
    const enc = new TextEncoder();
    const chunkText = (f: OwnerToPageFrame): string =>
      f.type === 'pty:chunk' ? dec.decode(f.data) : '';

    it('registers the run, streams the gate progress chunk, and only then runs the command', async () => {
      const gate = deferred();
      const out: OwnerToPageFrame[] = [];
      const server = createPtyServer({
        send: (f) => out.push(f),
        makeShell: () => new Shell({ cwd: '/', env: {} }),
        beforeRun: async (emit) => {
          emit('restoring project dependencies…\n', 'stdout');
          await gate.promise;
        },
      });
      server.handleFrame({ type: 'pty:open', sid: 's1' });
      const run = server.handleFrame({
        type: 'pty:exec',
        sid: 's1',
        rid: 'r1',
        line: 'echo hi',
        cols: 80,
        rows: 24,
        isTTY: true,
      });
      await Promise.resolve();
      // Gate pending: the progress chunk is out, the command has NOT run yet.
      const midTexts = out
        .filter((f) => f.type === 'pty:chunk')
        .map(chunkText)
        .join('');
      expect(midTexts).toContain('restoring project dependencies');
      expect(midTexts).not.toContain('hi\n');
      expect(out.some((f) => f.type === 'pty:exit')).toBe(false);
      gate.resolve();
      await run;
      const texts = out
        .filter((f) => f.type === 'pty:chunk')
        .map(chunkText)
        .join('');
      expect(texts.indexOf('restoring project dependencies')).toBeLessThan(texts.indexOf('hi'));
      const exit = out.find((f) => f.type === 'pty:exit');
      expect(exit && exit.type === 'pty:exit' && exit.code).toBe(0);
    });

    it('stdin sent while the gate is pending reaches the command (run registered up front)', async () => {
      const gate = deferred();
      const out: OwnerToPageFrame[] = [];
      const server = createPtyServer({
        send: (f) => out.push(f),
        makeShell: () => new Shell({ cwd: '/', env: {} }),
        beforeRun: () => gate.promise,
      });
      server.handleFrame({ type: 'pty:open', sid: 's1' });
      const run = server.handleFrame({
        type: 'pty:exec',
        sid: 's1',
        rid: 'r1',
        line: 'cat',
        cols: 80,
        rows: 24,
        isTTY: false,
      });
      await Promise.resolve();
      server.handleFrame({
        type: 'pty:stdin',
        sid: 's1',
        rid: 'r1',
        opId: 'stdin-1',
        data: enc.encode('ping\n'),
      });
      server.handleFrame({ type: 'pty:stdin-eof', sid: 's1', rid: 'r1', opId: 'stdin-2' });
      gate.resolve();
      await run;
      const texts = out
        .filter((f) => f.type === 'pty:chunk')
        .map(chunkText)
        .join('');
      expect(texts).toContain('ping');
    });

    it('ACKs queued stdin data and EOF only when the command reads them', async () => {
      const gate = deferred();
      const out: OwnerToPageFrame[] = [];
      const server = createPtyServer({
        send: (frame) => out.push(frame),
        makeShell: () => new Shell({ cwd: '/', env: {} }),
        beforeRun: () => gate.promise,
      });
      server.handleFrame({ type: 'pty:open', sid: 's1' });
      const run = server.handleFrame({
        type: 'pty:exec',
        sid: 's1',
        rid: 'r1',
        line: 'cat',
        cols: 80,
        rows: 24,
        isTTY: false,
      });
      await Promise.resolve();
      server.handleFrame({
        type: 'pty:stdin',
        sid: 's1',
        rid: 'r1',
        opId: 'queued-data',
        data: enc.encode('read me\n'),
      });
      server.handleFrame({
        type: 'pty:stdin-eof',
        sid: 's1',
        rid: 'r1',
        opId: 'queued-eof',
      });

      expect(out.filter((frame) => frame.type === 'pty:stdin-ack')).toEqual([]);
      gate.resolve();
      await run;

      expect(out.filter((frame) => frame.type === 'pty:stdin-ack')).toEqual([
        { type: 'pty:stdin-ack', sid: 's1', rid: 'r1', opId: 'queued-data', ok: true },
        { type: 'pty:stdin-ack', sid: 's1', rid: 'r1', opId: 'queued-eof', ok: true },
      ]);
    });

    it.each(['signal', 'close'] as const)(
      '%s before child attach rejects queued stdin data and EOF loudly',
      async (stopKind) => {
        const gate = deferred();
        const out: OwnerToPageFrame[] = [];
        const server = createPtyServer({
          send: (frame) => out.push(frame),
          makeShell: () => new Shell({ cwd: '/', env: {} }),
          beforeRun: () => gate.promise,
        });
        server.handleFrame({ type: 'pty:open', sid: 's1' });
        const run = server.handleFrame({
          type: 'pty:exec',
          sid: 's1',
          rid: 'r1',
          line: 'cat',
          cols: 80,
          rows: 24,
          isTTY: false,
        });
        await Promise.resolve();
        server.handleFrame({
          type: 'pty:stdin',
          sid: 's1',
          rid: 'r1',
          opId: 'queued-data',
          data: enc.encode('never-delivered'),
        });
        server.handleFrame({
          type: 'pty:stdin-eof',
          sid: 's1',
          rid: 'r1',
          opId: 'queued-eof',
        });

        const stopped =
          stopKind === 'signal'
            ? server.handleFrame({
                type: 'pty:signal',
                sid: 's1',
                rid: 'r1',
                signal: 'SIGINT',
              })
            : server.handleFrame({
                type: 'pty:close',
                sid: 's1',
                opId: 'close-before-attach',
              });
        await Promise.all([run, stopped]);

        const acks = out.filter((frame) => frame.type === 'pty:stdin-ack' && frame.rid === 'r1');
        expect(acks).toEqual([
          expect.objectContaining({
            type: 'pty:stdin-ack',
            opId: 'queued-data',
            ok: false,
            error: expect.stringMatching(/ClosedHandleError/),
          }),
          expect.objectContaining({
            type: 'pty:stdin-ack',
            opId: 'queued-eof',
            ok: false,
            error: expect.stringMatching(/ClosedHandleError/),
          }),
        ]);
      },
    );

    it('pty:signal during the pending gate: exit 130, the command never executes', async () => {
      const gate = deferred();
      const out: OwnerToPageFrame[] = [];
      const server = createPtyServer({
        send: (f) => out.push(f),
        makeShell: () => new Shell({ cwd: '/', env: {} }),
        beforeRun: () => gate.promise,
      });
      server.handleFrame({ type: 'pty:open', sid: 's1' });
      const run = server.handleFrame({
        type: 'pty:exec',
        sid: 's1',
        rid: 'r1',
        line: 'mkdir -p /work && cd /work',
        cols: 80,
        rows: 24,
        isTTY: true,
      });
      await Promise.resolve();
      server.handleFrame({ type: 'pty:signal', sid: 's1', rid: 'r1', signal: 'SIGINT' });
      gate.resolve();
      await run;
      const exit = out.find((f) => f.type === 'pty:exit' && f.rid === 'r1');
      expect(exit && exit.type === 'pty:exit' && exit.code).toBe(130);
      // The command must NOT have run after the user stopped it: cwd unchanged.
      expect(exit && exit.type === 'pty:exit' && exit.cwd).toBe('/');
    });

    it('pty:signal during the pending gate settles the run NOW — no waiting out the gate', async () => {
      // The gate never resolves: only the abort can settle the run. Pre-fix the
      // exec awaited the restore to completion, leaving the terminal busy for
      // seconds after a Ctrl-C (typed commands refused with `terminal is busy`).
      const gate = deferred();
      const out: OwnerToPageFrame[] = [];
      const server = createPtyServer({
        send: (f) => out.push(f),
        makeShell: () => new Shell({ cwd: '/', env: {} }),
        beforeRun: () => gate.promise,
      });
      server.handleFrame({ type: 'pty:open', sid: 's1' });
      const run = server.handleFrame({
        type: 'pty:exec',
        sid: 's1',
        rid: 'r1',
        line: 'echo hi',
        cols: 80,
        rows: 24,
        isTTY: true,
      });
      await Promise.resolve();
      server.handleFrame({ type: 'pty:signal', sid: 's1', rid: 'r1', signal: 'SIGINT' });
      await run; // must settle WITHOUT gate.resolve()
      const exit = out.find((f) => f.type === 'pty:exit' && f.rid === 'r1');
      expect(exit && exit.type === 'pty:exit' && exit.code).toBe(130);
    });

    it('gate progress chunks stop after the abort (no ghost restore lines at the prompt)', async () => {
      const gate = deferred();
      let emitProgress: ((chunk: string, stream: 'stdout' | 'stderr') => void) | undefined;
      const out: OwnerToPageFrame[] = [];
      const server = createPtyServer({
        send: (f) => out.push(f),
        makeShell: () => new Shell({ cwd: '/', env: {} }),
        beforeRun: (emit) => {
          emitProgress = emit;
          return gate.promise;
        },
      });
      server.handleFrame({ type: 'pty:open', sid: 's1' });
      const run = server.handleFrame({
        type: 'pty:exec',
        sid: 's1',
        rid: 'r1',
        line: 'echo hi',
        cols: 80,
        rows: 24,
        isTTY: true,
      });
      await Promise.resolve();
      server.handleFrame({ type: 'pty:signal', sid: 's1', rid: 'r1', signal: 'SIGINT' });
      await run;
      emitProgress?.('dependencies restored in 9.9s\n', 'stdout');
      gate.resolve();
      const texts = out
        .filter((f) => f.type === 'pty:chunk')
        .map(chunkText)
        .join('');
      expect(texts).not.toContain('dependencies restored');
    });

    it('pty:close during the pending gate: the command never executes', async () => {
      const gate = deferred();
      const out: OwnerToPageFrame[] = [];
      const server = createPtyServer({
        send: (f) => out.push(f),
        makeShell: () => new Shell({ cwd: '/', env: {} }),
        beforeRun: () => gate.promise,
      });
      server.handleFrame({ type: 'pty:open', sid: 's1' });
      const run = server.handleFrame({
        type: 'pty:exec',
        sid: 's1',
        rid: 'r1',
        line: 'mkdir -p /work && cd /work',
        cols: 80,
        rows: 24,
        isTTY: true,
      });
      await Promise.resolve();
      server.handleFrame({ type: 'pty:close', sid: 's1', opId: 'close-1' });
      gate.resolve();
      await run;
      const exit = out.find((f) => f.type === 'pty:exit' && f.rid === 'r1');
      expect(exit && exit.type === 'pty:exit' && exit.code).toBe(130);
      expect(exit && exit.type === 'pty:exit' && exit.cwd).toBe('/');
    });

    it('a blank line never invokes the gate (empty Enter stays instant and quiet)', async () => {
      let gateCalls = 0;
      const out: OwnerToPageFrame[] = [];
      const server = createPtyServer({
        send: (f) => out.push(f),
        makeShell: () => new Shell({ cwd: '/', env: {} }),
        beforeRun: () => {
          gateCalls += 1;
        },
      });
      server.handleFrame({ type: 'pty:open', sid: 's1' });
      await server.handleFrame({
        type: 'pty:exec',
        sid: 's1',
        rid: 'r1',
        line: '   ',
        cols: 80,
        rows: 24,
        isTTY: true,
      });
      expect(gateCalls).toBe(0);
      const exit = out.find((f) => f.type === 'pty:exit' && f.rid === 'r1');
      expect(exit && exit.type === 'pty:exit' && exit.code).toBe(0);
    });

    it('a beforeRun failure fails the run loudly and never executes the command', async () => {
      const out: OwnerToPageFrame[] = [];
      const server = createPtyServer({
        send: (f) => out.push(f),
        makeShell: () => new Shell({ cwd: '/', env: {} }),
        beforeRun: () => Promise.reject(new Error('deps gate broke')),
      });
      server.handleFrame({ type: 'pty:open', sid: 's1' });
      await server.handleFrame({
        type: 'pty:exec',
        sid: 's1',
        rid: 'r1',
        line: 'echo hi',
        cols: 80,
        rows: 24,
        isTTY: true,
      });
      const exit = out.find((f) => f.type === 'pty:exit');
      expect(exit && exit.type === 'pty:exit' && exit.code).toBe(1);
      expect(exit && exit.type === 'pty:exit' && exit.error).toContain('deps gate broke');
      const texts = out
        .filter((f) => f.type === 'pty:chunk')
        .map(chunkText)
        .join('');
      expect(texts).not.toContain('hi\n');
    });
  });
});
