import { EventEmitter } from 'node:events';
import { Shell } from '@riftydev/shell';
import { resetSyncMirror } from '@riftydev/vfs/internal';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnerToPageFrame } from '../glue/pty-protocol.ts';
import { type ForegroundChildHandle, runForegroundChild } from '../glue/run-foreground-child.ts';
import { type DevServerChildHandle, createOwnerChildDevServer } from './owner-child-dev-server.ts';
import { createPtyServer } from './pty-server.ts';

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
    queueMicrotask(() => this.emit('exit', null, 'SIGTERM'));
    return true;
  }
}

type FutureAck =
  | {
      readonly type: 'pty:ready';
      readonly sid: string;
      readonly error?: string;
    }
  | {
      readonly type: 'pty:resize-ack';
      readonly sid: string;
      readonly rid: string;
      readonly opId: string;
      readonly ok: boolean;
      readonly error?: string;
    }
  | {
      readonly type: 'pty:close-ack';
      readonly sid: string;
      readonly opId: string;
      readonly ok: boolean;
      readonly error?: string;
    };

function wireFrames(out: readonly OwnerToPageFrame[]): readonly (OwnerToPageFrame | FutureAck)[] {
  return out as readonly (OwnerToPageFrame | FutureAck)[];
}

describe('pty-server', () => {
  beforeEach(() => {
    resetSyncMirror(); // fresh in-memory owner store per test
  });

  it('open → ready', () => {
    const { server, out } = harness();
    server.handleFrame({ type: 'pty:open', sid: 's1' });
    expect(out.some((f) => f.type === 'pty:ready' && f.sid === 's1')).toBe(true);
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
      wireFrames(out)
        .filter(
          (frame): frame is Extract<FutureAck, { type: 'pty:resize-ack' }> =>
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
    expect(wireFrames(out)).toContainEqual(
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
        RIFTY_KERNEL_WORKER_URL: 'blob:kernel-worker',
        RIFTY_NODE_ENTRY_WORKER_URL: 'blob:node-worker',
        RIFTY_SQLITE_WASM_URL: 'blob:sqlite-wasm',
        RIFTY_ESBUILD_WASM_URL: 'blob:esbuild-wasm',
      },
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
              templateId: 'node-server',
              root: '/',
              devPort: 5174,
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

      expect(wireFrames(out)).toContainEqual({
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

    expect(wireFrames(out)).toContainEqual({
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
    expect(wireFrames(out).some((frame) => frame.type === 'pty:close-ack')).toBe(false);
    await close;
    expect(out).toContainEqual(expect.objectContaining({ type: 'pty:exit', rid: 'r1', code: 130 }));
    expect(wireFrames(out)).toContainEqual({
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
    const closeIndex = wireFrames(out).findIndex(
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
    const reopen = wireFrames(out).find((frame) => frame.type === 'pty:ready');

    await Promise.all([run, close]);
    expect(reopen).toEqual({
      type: 'pty:ready',
      sid: 's1',
      error: expect.stringMatching(/ClosedHandleError.*closing/i),
    });
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

  it('strips internal pty env keys from persisted exit env', async () => {
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
    expect(exit && exit.type === 'pty:exit' && exit.env.RIFTY_INTERNAL_PTY_SID).toBeUndefined();
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

        const acks = wireFrames(out).filter(
          (frame) => frame.type === 'pty:stdin-ack' && frame.rid === 'r1',
        );
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
