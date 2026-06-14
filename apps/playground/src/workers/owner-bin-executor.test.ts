/**
 * Owner in-realm `BinExecutor` (ADR-0146 P2 S1) mechanism tests.
 *
 * REAL `MemoryFsSync` + REAL `runNodeEntry` — no mock of the unit. A bin program
 * writes through the realm's global `process.stdout`/`process.stderr` (Node
 * parity); the executor must redirect those into the command context for the
 * run, then restore them. We let `getProcess` default to `globalThis.process`
 * so the fixture's `globalThis.process.stdout.write(...)` exercises the real
 * redirect path, and assert the global writers are restored afterwards.
 */

import type { CommandContext } from '@riftydev/shell';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { createOwnerBinExecutor } from './owner-bin-executor.ts';

interface CapturingCtx extends CommandContext {
  readonly _out: string[];
  readonly _err: string[];
}

function ctx(over: Partial<CommandContext> = {}): CapturingCtx {
  const out: string[] = [];
  const err: string[] = [];
  return {
    cwd: '/proj',
    env: {},
    stdout: { write: (c) => void out.push(c) },
    stderr: { write: (c) => void err.push(c) },
    isTTY: true,
    ...over,
    _out: out,
    _err: err,
  };
}

describe('owner-bin-executor', () => {
  it('runs a trivial in-VFS .bin shim in-realm and streams its stdout to ctx.stdout', async () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/proj/node_modules/.bin/cli': "#!/usr/bin/env node\nimport('../widget/cli.js');\n",
      '/proj/node_modules/widget/package.json': JSON.stringify({ name: 'widget' }),
      // Bin programs write through the realm's global process.stdout (Node parity).
      '/proj/node_modules/widget/cli.js':
        "globalThis.process.stdout.write('cow says moo\\n');\nmodule.exports = {};\n",
    });
    const exec = createOwnerBinExecutor({ getVfs: () => vfs });
    const c = ctx();

    const code = await exec('/proj/node_modules/.bin/cli', [], c);
    await new Promise((r) => setTimeout(r, 0)); // settle the shim's dynamic import

    expect(code).toBe(0);
    expect(c._out.join('')).toContain('cow says moo');
  });

  it('routes a bin program stderr to ctx.stderr', async () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/proj/node_modules/.bin/cli': "#!/usr/bin/env node\nimport('../widget/cli.js');\n",
      '/proj/node_modules/widget/package.json': JSON.stringify({ name: 'widget' }),
      '/proj/node_modules/widget/cli.js':
        "globalThis.process.stderr.write('boom\\n');\nmodule.exports = {};\n",
    });
    const exec = createOwnerBinExecutor({ getVfs: () => vfs });
    const c = ctx();

    await exec('/proj/node_modules/.bin/cli', [], c);
    await new Promise((r) => setTimeout(r, 0));

    expect(c._err.join('')).toContain('boom');
  });

  it('restores the realm process stdio after the run (no leaked redirect)', async () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({ '/work/script.js': "globalThis.process.stdout.write('hi\\n');\n" });
    const proc = globalThis.process as unknown as {
      stdout: { write: unknown };
      stderr: { write: unknown };
    };
    const beforeStdoutWrite = proc.stdout.write;
    const beforeStderrWrite = proc.stderr.write;
    const exec = createOwnerBinExecutor({ getVfs: () => vfs });

    await exec('/work/script.js', [], ctx({ cwd: '/work' }));

    expect(proc.stdout.write).toBe(beforeStdoutWrite); // writer restored, not the run's redirect
    expect(proc.stderr.write).toBe(beforeStderrWrite);
  });

  it('surfaces a run error as exit 1 + ctx.stderr (never a silent 0)', async () => {
    const vfs = new MemoryFsSync();
    // A .bin shim that is not a recognizable launcher → runNodeEntry throws.
    vfs.loadFixture({ '/proj/node_modules/.bin/weird': 'not a launcher\n' });
    const exec = createOwnerBinExecutor({ getVfs: () => vfs });
    const c = ctx();

    const code = await exec('/proj/node_modules/.bin/weird', [], c);

    expect(code).toBe(1);
    expect(c._err.join('')).toMatch(/launcher/i);
  });

  it('honors ctx.signal: aborts before running and reports exit 130', async () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({ '/work/script.js': 'globalThis.__ranScript = true;\n' });
    (globalThis as Record<string, unknown>).__ranScript = false;
    const controller = new AbortController();
    controller.abort();
    const exec = createOwnerBinExecutor({ getVfs: () => vfs });

    const code = await exec(
      '/work/script.js',
      [],
      ctx({ cwd: '/work', signal: controller.signal }),
    );

    expect(code).toBe(130);
    expect((globalThis as Record<string, unknown>).__ranScript).toBe(false); // never ran
  });
});
