/**
 * PATH-style `node_modules/.bin/<name>` resolution + execution dispatch
 * (closes the historical shell .bin execution backlog).
 *
 * Each case pins one failure mode of the dispatch contract:
 *   - a bare name with no builtin resolves to the nearest `.bin/<name>` shim
 *     (walk-up from cwd) and runs through the injected `execBin` seam;
 *   - registered commands (builtins + `registerCommand`) WIN over a same-named
 *     shim (resolution order: builtins → walk-up `.bin` → miss);
 *   - nearest `node_modules` wins; an ancestor's `.bin` is found on walk-up;
 *   - a name containing `/` is a path, never a PATH lookup (bash);
 *   - shim present but NO executor wired ⇒ exit 126 (installed, not runnable
 *     here), distinct from the 127 not-found miss — never a silent stub;
 *   - the executor's exit code is the segment exit code, args reach it, and a
 *     resolved bin honors `>` redirection (goes through the handler path).
 *
 * Real Memory VFS (`syncMirror`) is seeded with shim files — the only mock is
 * the injected `execBin`, which stands in for the host's Node runtime (an
 * unavoidable external boundary; a real Worker is e2e-only).
 */

import { syncMirror } from '@riftydev/vfs';
import { resetSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';
import { type BinExecutor, Shell, ShellCommandLifecycleError } from '../src/index.ts';

afterEach(() => {
  resetSyncMirror();
});

const enc = new TextEncoder();

/** Write a launcher shim at `<dir>/node_modules/.bin/<name>` (linker format). */
function seedBin(dir: string, name: string, pkg = name): void {
  const fs = syncMirror();
  const binDir = `${dir}/node_modules/.bin`;
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(
    `${binDir}/${name}`,
    enc.encode(`#!/usr/bin/env node\nimport('../${pkg}/bin.js');\n`),
  );
}

interface ExecRecord {
  readonly binPath: string;
  readonly args: string[];
}

/** Recording stub for the injected Node executor (the host boundary). */
function makeExecBin(opts: { exitCode?: number; stdout?: string } = {}): {
  execBin: BinExecutor;
  calls: ExecRecord[];
} {
  const calls: ExecRecord[] = [];
  const execBin: BinExecutor = async (binPath, args, ctx) => {
    calls.push({ binPath, args: [...args] });
    if (opts.stdout) ctx.stdout.write(opts.stdout);
    return opts.exitCode ?? 0;
  };
  return { execBin, calls };
}

describe('Shell — node_modules/.bin resolution', () => {
  it('runs a bare name via the nearest .bin shim through execBin', async () => {
    seedBin('/proj', 'mycli');
    const { execBin, calls } = makeExecBin({ exitCode: 0, stdout: 'ran\n' });
    const sh = new Shell({ cwd: '/proj', execBin });

    const r = await sh.run('mycli --flag value');

    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('ran\n');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.binPath).toBe('/proj/node_modules/.bin/mycli');
    expect(calls[0]?.args).toEqual(['--flag', 'value']);
  });

  it("propagates the executor's exit code", async () => {
    seedBin('/proj', 'failer');
    const { execBin } = makeExecBin({ exitCode: 2 });
    const sh = new Shell({ cwd: '/proj', execBin });

    const r = await sh.run('failer');
    expect(r.exitCode).toBe(2);
  });

  it('walks up to an ancestor node_modules/.bin when cwd has none', async () => {
    seedBin('/proj', 'tool'); // shim at /proj, cwd is /proj/src/sub
    const fs = syncMirror();
    fs.mkdirSync('/proj/src/sub', { recursive: true });
    const { execBin, calls } = makeExecBin();
    const sh = new Shell({ cwd: '/proj/src/sub', execBin });

    const r = await sh.run('tool');
    expect(r.exitCode).toBe(0);
    expect(calls[0]?.binPath).toBe('/proj/node_modules/.bin/tool');
  });

  it('nearest node_modules wins over a farther ancestor', async () => {
    seedBin('/proj', 'tool', 'outer');
    seedBin('/proj/inner', 'tool', 'inner');
    const fs = syncMirror();
    fs.mkdirSync('/proj/inner/src', { recursive: true });
    const { execBin, calls } = makeExecBin();
    const sh = new Shell({ cwd: '/proj/inner/src', execBin });

    await sh.run('tool');
    expect(calls[0]?.binPath).toBe('/proj/inner/node_modules/.bin/tool');
  });

  it('resolves from the root cwd without a double-slashed path', async () => {
    seedBin('', 'rootcli'); // shim at /node_modules/.bin/rootcli
    const { execBin, calls } = makeExecBin();
    const sh = new Shell({ cwd: '/', execBin });

    const r = await sh.run('rootcli');
    expect(r.exitCode).toBe(0);
    expect(calls[0]?.binPath).toBe('/node_modules/.bin/rootcli');
  });

  it('a registered command wins over a same-named .bin shim', async () => {
    seedBin('/proj', 'echo'); // never reached: echo is a builtin
    const { execBin, calls } = makeExecBin();
    const sh = new Shell({ cwd: '/proj', execBin });

    const r = await sh.run('echo hi');
    expect(r.stdout).toBe('hi\n');
    expect(calls).toHaveLength(0);
  });

  it('a custom registerCommand wins over a same-named .bin shim', async () => {
    seedBin('/proj', 'vite');
    const { execBin, calls } = makeExecBin();
    const sh = new Shell({ cwd: '/proj', execBin });
    sh.registerCommand('vite', async (_args, ctx) => {
      ctx.stdout.write('builtin-vite\n');
      return 0;
    });

    const r = await sh.run('vite');
    expect(r.stdout).toBe('builtin-vite\n');
    expect(calls).toHaveLength(0);
  });

  it('reports a directed path miss without falling back to a same-named .bin', async () => {
    seedBin('/proj', 'foo');
    const { execBin, calls } = makeExecBin();
    const sh = new Shell({ cwd: '/proj', execBin });

    const r = await sh.run('./foo');
    expect(r).toMatchObject({
      exitCode: 127,
      stderr: './foo: No such file or directory\n',
    });
    expect(calls).toHaveLength(0);
  });

  it('no shim and no handler ⇒ command not found, exit 127', async () => {
    const { execBin, calls } = makeExecBin();
    const sh = new Shell({ cwd: '/proj', execBin });

    const r = await sh.run('nope');
    expect(r.exitCode).toBe(127);
    expect(r.stderr).toMatch(/nope: command not found/);
    expect(calls).toHaveLength(0);
  });

  it('shim present but no executor wired ⇒ exit 126, not 127, with a clear diagnostic', async () => {
    seedBin('/proj', 'tsc');
    const sh = new Shell({ cwd: '/proj' }); // no execBin

    const r = await sh.run('tsc');
    expect(r.exitCode).toBe(126);
    expect(r.stderr).toMatch(/tsc/);
    expect(r.stderr).toMatch(/node_modules\/\.bin\/tsc/);
    expect(r.stderr).not.toMatch(/command not found/);
  });

  it('a resolved bin honors > redirection (runs through the handler path)', async () => {
    seedBin('/proj', 'gen');
    const { execBin } = makeExecBin({ stdout: 'payload\n' });
    const sh = new Shell({ cwd: '/proj', execBin });

    const r = await sh.run('gen > out.txt');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe(''); // diverted to the file
    expect(new TextDecoder().decode(syncMirror().readFileBytesSync('/proj/out.txt'))).toBe(
      'payload\n',
    );
  });

  it('resolves from the live cwd after cd, not the constructor cwd', async () => {
    seedBin('/proj/inner', 'tool'); // only present under /proj/inner
    const { execBin, calls } = makeExecBin();
    const sh = new Shell({ cwd: '/proj', execBin });

    // At /proj the shim is invisible (walk-up never reaches /proj/inner).
    expect((await sh.run('tool')).exitCode).toBe(127);
    await sh.run('cd inner');
    const r = await sh.run('tool');

    expect(r.exitCode).toBe(0);
    expect(calls.at(-1)?.binPath).toBe('/proj/inner/node_modules/.bin/tool');
  });

  it('a throwing execBin surfaces as a clean cmd error (exit 1), not an unhandled rejection', async () => {
    seedBin('/proj', 'tool');
    const sh = new Shell({
      cwd: '/proj',
      execBin: async () => {
        throw new Error('spawn unavailable');
      },
    });

    const r = await sh.run('tool');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/tool: spawn unavailable/);
  });

  it('a host lifecycle failure rejects because no process exit is known', async () => {
    seedBin('/proj', 'tool');
    const sh = new Shell({
      cwd: '/proj',
      execBin: async () => {
        throw new ShellCommandLifecycleError('Worker peer closed unexpectedly');
      },
    });

    await expect(sh.run('tool')).rejects.toThrow(/peer closed unexpectedly/i);
  });

  it('an aggregated host lifecycle failure rejects because no process exit is known', async () => {
    seedBin('/proj', 'tool');
    const lifecycle = new ShellCommandLifecycleError('Worker peer closed unexpectedly');
    const cleanup = new Error('preview cleanup failed');
    const sh = new Shell({
      cwd: '/proj',
      execBin: async () => {
        throw new AggregateError([lifecycle, cleanup], 'child lifecycle and cleanup failed');
      },
    });

    await expect(sh.run('tool')).rejects.toMatchObject({
      errors: [lifecycle, cleanup],
    });
  });

  it('background (&) jobs can run a resolved bin (execBin threads to the clone)', async () => {
    seedBin('/proj', 'daemon');
    const { execBin, calls } = makeExecBin({ exitCode: 0 });
    const sh = new Shell({ cwd: '/proj', execBin });

    const r = await sh.run('daemon &');
    expect(r.exitCode).toBe(0); // job started
    // let the background job settle
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls.map((c) => c.binPath)).toContain('/proj/node_modules/.bin/daemon');
  });
});

describe('which — reports .bin hits', () => {
  it('prints the resolved .bin path for an installed CLI, exit 0', async () => {
    seedBin('/proj', 'eslint');
    const sh = new Shell({ cwd: '/proj' });

    const r = await sh.run('which eslint');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('/proj/node_modules/.bin/eslint\n');
  });

  it('still prints the bare NAME for a builtin (no PATH path for builtins)', async () => {
    const sh = new Shell({ cwd: '/proj' });
    const r = await sh.run('which echo');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('echo\n');
  });

  it('a builtin shadows a same-named .bin in which output', async () => {
    seedBin('/proj', 'echo');
    const sh = new Shell({ cwd: '/proj' });
    const r = await sh.run('which echo');
    expect(r.stdout).toBe('echo\n'); // builtin form, not the .bin path
  });

  it('is silent on a genuine miss, exit 1', async () => {
    const sh = new Shell({ cwd: '/proj' });
    const r = await sh.run('which ghost');
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe('');
  });
});
