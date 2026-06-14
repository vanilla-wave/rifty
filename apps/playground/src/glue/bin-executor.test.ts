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
import { describe, expect, it } from 'vitest';
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
  emitExit: (code: number | null) => void;
  killedWith: () => string | null;
  spawnCount: () => number;
} {
  let captured: BinSpawnRequest | null = null;
  let count = 0;
  let onOut: (c: unknown) => void = () => {};
  let onErr: (c: unknown) => void = () => {};
  let onExit: (code?: unknown) => void = () => {};
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
    on: (_e, l) => {
      onExit = l;
    },
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
    emitExit: (code) => onExit(code),
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
    const code = await p;

    expect(code).toBe(0);
    expect(out()).toBe('hello\n');
    const req = fake.req();
    expect(req?.shimPath).toBe('/proj/node_modules/.bin/cli');
    expect(req?.args).toEqual(['--flag', 'x']);
    expect(req?.cwd).toBe('/proj');
    expect(req?.env).toEqual({ FOO: 'bar' });
  });

  it('propagates a non-zero exit code', async () => {
    const fake = makeFakeSpawn();
    const exec = createBinExecutor({ spawn: fake.spawn });
    const { ctx } = makeCtx();
    const p = exec('/proj/node_modules/.bin/tsc', [], ctx);
    fake.emitExit(3);
    expect(await p).toBe(3);
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
    fake.emitExit(null); // worker winds down after the kill
    await p;
  });

  it('kills the worker when ctx.signal is ALREADY aborted at exec entry', async () => {
    const fake = makeFakeSpawn();
    const exec = createBinExecutor({ spawn: fake.spawn });
    const controller = new AbortController();
    controller.abort(); // aborted BEFORE exec — exercises the synchronous branch
    const { ctx } = makeCtx({ signal: controller.signal });
    const p = exec('/proj/node_modules/.bin/dev', [], ctx);
    expect(fake.killedWith()).toBe('SIGTERM');
    fake.emitExit(null);
    await p;
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
    fake.emitExit(null);
    await p;

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
});
