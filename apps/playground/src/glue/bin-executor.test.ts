/**
 * Unit tests for the playground `BinExecutor` glue (ADR-0137, Opt-Y) — the host
 * side that spawns the `kind:'url'` node-entry bootstrap for a shell-resolved
 * `node_modules/.bin/<name>` shim.
 *
 * The real spawn target is a kernel Worker (an unavoidable external boundary,
 * e2e-only). Here the spawn is injected as a fake handle, so these tests pin MY
 * glue: the spawn request built from the shim path + args + ctx, stdout/stderr
 * piping to the command context, abort→kill + trailing-output mute, and
 * exit-code propagation. No rifty sibling package is mocked.
 */

import type { CommandContext } from '@riftydev/shell';
import { describe, expect, it, vi } from 'vitest';
import { type BinSpawnRequest, type BinWorkerHandle, createBinExecutor } from './bin-executor.ts';

const enc = new TextEncoder();

function makeCtx(over: Partial<CommandContext> = {}): {
  ctx: CommandContext;
  out: () => string;
  err: () => string;
} {
  let out = '';
  let err = '';
  const ctx: CommandContext = {
    cwd: '/proj',
    env: { FOO: 'bar' },
    stdout: {
      write: (c) => {
        out += c;
      },
    },
    stderr: {
      write: (c) => {
        err += c;
      },
    },
    ...over,
  };
  return { ctx, out: () => out, err: () => err };
}

/** Controllable fake worker handle + spawn recorder. */
function makeFakeSpawn(): {
  spawn: (req: BinSpawnRequest) => BinWorkerHandle;
  req: () => BinSpawnRequest | null;
  emitStdout: (chunk: Uint8Array) => void;
  emitStderr: (chunk: Uint8Array) => void;
  emitMessage: (message: unknown) => void;
  emitExit: (code: number | null, signal?: 'SIGINT' | 'SIGTERM' | null) => void;
  killedWith: () => string | null;
  spawnCount: () => number;
} {
  let captured: BinSpawnRequest | null = null;
  let count = 0;
  let onOut: (c: unknown) => void = () => {};
  let onErr: (c: unknown) => void = () => {};
  let onExit: (code?: unknown, signal?: unknown) => void = () => {};
  let onMessage: (message: unknown) => void = () => {};
  let killed: string | null = null;
  const handle: BinWorkerHandle = {
    stdout: () => ({
      on: (_e, l) => {
        onOut = l;
      },
    }),
    stderr: () => ({
      on: (_e, l) => {
        onErr = l;
      },
    }),
    stdin: () => {
      throw new Error('unexpected stdin access');
    },
    on: (event, listener) => {
      if (event === 'exit') {
        onExit = listener as (code?: unknown, signal?: unknown) => void;
      }
      if (event === 'message') onMessage = listener as (message: unknown) => void;
    },
    resize: () => true,
    kill: (signal) => {
      killed = signal ?? 'SIGTERM';
    },
  };
  return {
    spawn: (req) => {
      captured = req;
      count++;
      return handle;
    },
    req: () => captured,
    emitStdout: (c) => onOut(c),
    emitStderr: (c) => onErr(c),
    emitMessage: (m) => onMessage(m),
    emitExit: (code, signal = null) => onExit(code, signal),
    killedWith: () => killed,
    spawnCount: () => count,
  };
}

describe('createBinExecutor', () => {
  it('spawns the node-entry worker for the shim and streams stdout, propagating exit 0', async () => {
    const fake = makeFakeSpawn();
    const exec = createBinExecutor({ spawn: fake.spawn });
    const { ctx, out } = makeCtx();

    const p = exec('/proj/node_modules/.bin/cli', ['--flag', 'x'], ctx);
    fake.emitStdout(enc.encode('hello\n'));
    fake.emitExit(0);
    const exit = await p;

    expect(exit).toEqual({ code: 0, signal: null });
    expect(out()).toBe('hello\n');
    const req = fake.req();
    expect(req?.shimPath).toBe('/proj/node_modules/.bin/cli');
    expect(req?.args).toEqual(['--flag', 'x']);
    expect(req?.cwd).toBe('/proj');
    expect(req?.env).toEqual({ FOO: 'bar' });
    expect(req?.isTTY).toBe(false);
  });

  it('passes terminal TTY metadata into the bin spawn request', async () => {
    const fake = makeFakeSpawn();
    const exec = createBinExecutor({ spawn: fake.spawn });
    const { ctx } = makeCtx({ isTTY: true, cols: 120, rows: 40 });

    const p = exec('/proj/node_modules/.bin/prettier', ['--write', 'src/a.ts'], ctx);
    fake.emitExit(0);
    await p;

    expect(fake.req()?.isTTY).toBe(true);
    expect(fake.req()).toMatchObject({ cols: 120, rows: 40 });
  });

  it('prepares host-only launch metadata before hooks and spawn', async () => {
    const fake = makeFakeSpawn();
    const onStart = vi.fn();
    const exec = createBinExecutor({
      spawn: fake.spawn,
      prepareRequest: (req) => ({ ...req, previewScope: 'scope-a' }),
      onStart,
    });
    const { ctx } = makeCtx({ env: { USER_VALUE: 'kept' } });

    const run = exec('/proj/node_modules/.bin/vite', [], ctx);
    fake.emitExit(0);
    await run;

    expect(fake.req()).toMatchObject({ previewScope: 'scope-a', env: { USER_VALUE: 'kept' } });
    expect(onStart).toHaveBeenCalledWith(fake.req(), ctx);
  });

  it('propagates a non-zero exit code', async () => {
    const fake = makeFakeSpawn();
    const exec = createBinExecutor({ spawn: fake.spawn });
    const { ctx } = makeCtx();
    const p = exec('/proj/node_modules/.bin/tsc', [], ctx);
    fake.emitExit(3);
    expect(await p).toEqual({ code: 3, signal: null });
  });

  it('forwards child messages and exit through request-aware hooks', async () => {
    const fake = makeFakeSpawn();
    const onMessage = vi.fn();
    const onExit = vi.fn();
    const exec = createBinExecutor({ spawn: fake.spawn, onMessage, onExit });
    const { ctx } = makeCtx();

    const p = exec('/proj/node_modules/.bin/vite', [], ctx);
    fake.emitMessage({ type: 'rifty:node-listening', ports: [5174] });
    fake.emitExit(0);

    expect(await p).toEqual({ code: 0, signal: null });
    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({ shimPath: '/proj/node_modules/.bin/vite' }),
      { type: 'rifty:node-listening', ports: [5174] },
      ctx,
    );
    expect(onExit).toHaveBeenCalledWith(
      expect.objectContaining({ shimPath: '/proj/node_modules/.bin/vite' }),
      ctx,
    );
  });

  it('streams stderr to ctx.stderr', async () => {
    const fake = makeFakeSpawn();
    const exec = createBinExecutor({ spawn: fake.spawn });
    const { ctx, err } = makeCtx();
    const p = exec('/proj/node_modules/.bin/cli', [], ctx);
    fake.emitStderr(enc.encode('boom\n'));
    fake.emitExit(1);
    await p;
    expect(err()).toBe('boom\n');
  });

  it('kills the worker when ctx.signal aborts', async () => {
    const fake = makeFakeSpawn();
    const exec = createBinExecutor({ spawn: fake.spawn });
    const controller = new AbortController();
    const { ctx } = makeCtx({ signal: controller.signal });
    const p = exec('/proj/node_modules/.bin/dev', [], ctx);
    controller.abort();
    expect(fake.killedWith()).toBe('SIGTERM');
    fake.emitExit(null, 'SIGTERM'); // worker winds down after the kill
    await expect(p).resolves.toEqual({ code: null, signal: 'SIGTERM' });
  });

  it('kills the worker when ctx.signal is ALREADY aborted at exec entry', async () => {
    const fake = makeFakeSpawn();
    const exec = createBinExecutor({ spawn: fake.spawn });
    const controller = new AbortController();
    controller.abort(); // aborted BEFORE exec — exercises the synchronous branch
    const { ctx } = makeCtx({ signal: controller.signal });
    const p = exec('/proj/node_modules/.bin/dev', [], ctx);
    expect(fake.killedWith()).toBe('SIGTERM');
    fake.emitExit(null, 'SIGTERM');
    await expect(p).resolves.toEqual({ code: null, signal: 'SIGTERM' });
  });

  it('mutes worker output buffered after an abort', async () => {
    const fake = makeFakeSpawn();
    const exec = createBinExecutor({ spawn: fake.spawn });
    const controller = new AbortController();
    const { ctx, out } = makeCtx({ signal: controller.signal });

    const p = exec('/proj/node_modules/.bin/dev', [], ctx);
    fake.emitStdout(enc.encode('before\n'));
    controller.abort();
    fake.emitStdout(enc.encode('after-kill\n')); // post-SIGTERM buffer — must not surface
    fake.emitExit(null, 'SIGTERM');
    await expect(p).resolves.toEqual({ code: null, signal: 'SIGTERM' });

    expect(out()).toBe('before\n');
  });

  it('rejects when spawn throws, so the host boundary error surfaces to the shell', async () => {
    const exec = createBinExecutor({
      spawn: () => {
        throw new Error('SAB IPC gated');
      },
    });
    const { ctx } = makeCtx();
    await expect(exec('/proj/node_modules/.bin/cli', [], ctx)).rejects.toThrow('SAB IPC gated');
  });

  it('a pre-aborted signal still resolves when kill() emits exit synchronously', async () => {
    // The real WorkerHandle.kill() emits 'exit' synchronously. The shared
    // run-foreground-child driver registers the exit listener BEFORE acting on an
    // already-aborted signal; with the old inline bin ordering (signal handling
    // first) that synchronous exit would be lost and this would hang forever.
    let exitCb: ((code?: unknown, signal?: unknown) => void) | undefined;
    const handle: BinWorkerHandle = {
      stdout: () => ({ on: () => {} }),
      stderr: () => ({ on: () => {} }),
      stdin: () => {
        throw new Error('unexpected stdin access');
      },
      on: (ev, l) => {
        if (ev === 'exit') exitCb = l as (code?: unknown, signal?: unknown) => void;
      },
      resize: () => true,
      kill: () => {
        exitCb?.(null, 'SIGTERM'); // synchronous, like the real handle
      },
    };
    const exec = createBinExecutor({ spawn: () => handle });
    const controller = new AbortController();
    controller.abort();
    const { ctx } = makeCtx({ signal: controller.signal });

    expect(await exec('/proj/node_modules/.bin/dev', [], ctx)).toEqual({
      code: null,
      signal: 'SIGTERM',
    });
  });
});
