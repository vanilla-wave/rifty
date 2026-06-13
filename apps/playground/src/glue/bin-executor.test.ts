/**
 * Unit tests for the playground `BinExecutor` glue (ADR-0137) — the host side
 * that runs a shell-resolved `node_modules/.bin/<name>` shim as a Node entry.
 *
 * The real spawn target is a kernel Worker (an unavoidable external boundary,
 * e2e-only). Here the spawn is injected as a fake handle, so these tests pin
 * MY glue: the 'source' spec built from the shim bytes, stdout/stderr piping to
 * the command context, abort→kill, exit-code propagation, and the missing-shim
 * guard. No rifty sibling package is mocked.
 */

import type { CommandContext } from '@riftydev/shell';
import { describe, expect, it } from 'vitest';
import { type BinSpawnSpec, type BinWorkerHandle, createBinExecutor } from './bin-executor.ts';

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
  spawn: (spec: BinSpawnSpec) => BinWorkerHandle;
  spec: () => BinSpawnSpec | null;
  emitStdout: (chunk: Uint8Array) => void;
  emitStderr: (chunk: Uint8Array) => void;
  emitExit: (code: number | null) => void;
  killedWith: () => string | null;
  spawnCount: () => number;
} {
  let captured: BinSpawnSpec | null = null;
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
    spawn: (spec) => {
      captured = spec;
      count++;
      return handle;
    },
    spec: () => captured,
    emitStdout: (c) => onOut(c),
    emitStderr: (c) => onErr(c),
    emitExit: (code) => onExit(code),
    killedWith: () => killed,
    spawnCount: () => count,
  };
}

describe('createBinExecutor', () => {
  it('spawns a source-entry worker from the shim and streams stdout, propagating exit 0', async () => {
    const fake = makeFakeSpawn();
    const shim = "#!/usr/bin/env node\nimport('../cli/bin.js');\n";
    const exec = createBinExecutor({
      readShim: () => enc.encode(shim),
      spawn: fake.spawn,
    });
    const { ctx, out } = makeCtx();

    const p = exec('/proj/node_modules/.bin/cli', ['--flag', 'x'], ctx);
    fake.emitStdout(enc.encode('hello\n'));
    fake.emitExit(0);
    const code = await p;

    expect(code).toBe(0);
    expect(out()).toBe('hello\n');
    const spec = fake.spec();
    expect(spec?.code).toBe(shim);
    expect(spec?.sourceUrl).toBe('/proj/node_modules/.bin/cli');
    expect(spec?.argv).toEqual(['rifty', '/proj/node_modules/.bin/cli', '--flag', 'x']);
    expect(spec?.cwd).toBe('/proj');
    expect(spec?.env).toEqual({ FOO: 'bar' });
  });

  it('propagates a non-zero exit code', async () => {
    const fake = makeFakeSpawn();
    const exec = createBinExecutor({ readShim: () => enc.encode('x'), spawn: fake.spawn });
    const { ctx } = makeCtx();
    const p = exec('/proj/node_modules/.bin/tsc', [], ctx);
    fake.emitExit(3);
    expect(await p).toBe(3);
  });

  it('streams stderr to ctx.stderr', async () => {
    const fake = makeFakeSpawn();
    const exec = createBinExecutor({ readShim: () => enc.encode('x'), spawn: fake.spawn });
    const { ctx, err } = makeCtx();
    const p = exec('/proj/node_modules/.bin/cli', [], ctx);
    fake.emitStderr(enc.encode('boom\n'));
    fake.emitExit(1);
    await p;
    expect(err()).toBe('boom\n');
  });

  it('kills the worker when ctx.signal aborts', async () => {
    const fake = makeFakeSpawn();
    const exec = createBinExecutor({ readShim: () => enc.encode('x'), spawn: fake.spawn });
    const controller = new AbortController();
    const { ctx } = makeCtx({ signal: controller.signal });
    const p = exec('/proj/node_modules/.bin/dev', [], ctx);
    controller.abort();
    expect(fake.killedWith()).toBe('SIGTERM');
    fake.emitExit(null); // worker winds down after the kill
    await p;
  });

  it('reports exit 126 and never spawns when the shim cannot be read', async () => {
    const fake = makeFakeSpawn();
    const exec = createBinExecutor({ readShim: () => null, spawn: fake.spawn });
    const { ctx, err } = makeCtx();
    const code = await exec('/proj/node_modules/.bin/gone', [], ctx);
    expect(code).toBe(126);
    expect(err()).toMatch(/gone/);
    expect(fake.spawnCount()).toBe(0);
  });

  it('mutes worker output buffered after an abort', async () => {
    const fake = makeFakeSpawn();
    const exec = createBinExecutor({ readShim: () => enc.encode('x'), spawn: fake.spawn });
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
      readShim: () => enc.encode('x'),
      spawn: () => {
        throw new Error('SAB IPC gated');
      },
    });
    const { ctx } = makeCtx();
    await expect(exec('/proj/node_modules/.bin/cli', [], ctx)).rejects.toThrow('SAB IPC gated');
  });
});
