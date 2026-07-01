/**
 * Shell pipes (`a | b`) — buffered stdout→stdin hand-off + the launch-slice
 * filters (cat/grep/wc/head/tail) draining `ctx.stdin` when given no FILE.
 */
import { resetSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';
import { cat } from '../src/commands/cat.ts';
import { grep } from '../src/commands/grep.ts';
import { head } from '../src/commands/head.ts';
import { tail } from '../src/commands/tail.ts';
import { wc } from '../src/commands/wc.ts';
import { Shell } from '../src/index.ts';
import type { CommandContext, StdinReader } from '../src/types.ts';

afterEach(() => resetSyncMirror());

/** A one-shot stdin reader over `s` (yields once, then EOF) — like a pipe RHS. */
function stdinOf(s: string): StdinReader {
  let done = false;
  const bytes = new TextEncoder().encode(s);
  return {
    read: async () => {
      if (done) return null;
      done = true;
      return bytes;
    },
  };
}

function ctxWithStdin(s: string | null): {
  ctx: CommandContext;
  out: () => string;
  err: () => string;
} {
  let outBuf = '';
  let errBuf = '';
  const ctx: CommandContext = {
    cwd: '/',
    env: {},
    stdout: {
      write: (c) => {
        outBuf += c;
      },
    },
    stderr: {
      write: (c) => {
        errBuf += c;
      },
    },
    ...(s === null ? {} : { stdin: stdinOf(s) }),
  };
  return { ctx, out: () => outBuf, err: () => errBuf };
}

/** Seed /a.txt with four lines via the working `>`/`>>` redirect. */
async function seed(sh: Shell): Promise<void> {
  await sh.run('echo alpha > /a.txt');
  await sh.run('echo beta >> /a.txt');
  await sh.run('echo gamma >> /a.txt');
  await sh.run('echo "beta two" >> /a.txt');
}

describe('Shell — pipes (integration)', () => {
  it('cat f | wc -l → line count', async () => {
    const sh = new Shell({ cwd: '/' });
    await seed(sh);
    const r = await sh.run('cat /a.txt | wc -l');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('4\n');
  });

  it('cat f | grep beta → only matching lines, exit 0', async () => {
    const sh = new Shell({ cwd: '/' });
    await seed(sh);
    const r = await sh.run('cat /a.txt | grep beta');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('beta\nbeta two\n');
  });

  it('3-stage chain cat f | grep beta | wc -l → 2', async () => {
    const sh = new Shell({ cwd: '/' });
    await seed(sh);
    const r = await sh.run('cat /a.txt | grep beta | wc -l');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('2\n');
  });

  it('cat f | head -n 2 / tail -n 1', async () => {
    const sh = new Shell({ cwd: '/' });
    await seed(sh);
    expect((await sh.run('cat /a.txt | head -n 2')).stdout).toBe('alpha\nbeta\n');
    expect((await sh.run('cat /a.txt | tail -n 1')).stdout).toBe('beta two\n');
  });

  it('pipeline exit = last stage (grep no-match → 1)', async () => {
    const sh = new Shell({ cwd: '/' });
    await seed(sh);
    const r = await sh.run('cat /a.txt | grep nope');
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe('');
  });

  it('last-stage exit wins even when an earlier stage failed', async () => {
    const sh = new Shell({ cwd: '/' });
    const r = await sh.run('false | echo ok');
    expect(r.stdout).toBe('ok\n');
    expect(r.exitCode).toBe(0);
  });

  it('ls | wc -l counts entries', async () => {
    const sh = new Shell({ cwd: '/' });
    await sh.run('mkdir -p /d');
    await sh.run('echo x > /d/one');
    await sh.run('echo x > /d/two');
    const r = await sh.run('cd /d');
    expect(r.exitCode).toBe(0);
    const w = await sh.run('ls | wc -l');
    expect(w.stdout).toBe('2\n');
  });

  it('redirect composes with pipe: a | b > f', async () => {
    const sh = new Shell({ cwd: '/' });
    await seed(sh);
    const r = await sh.run('cat /a.txt | grep beta > /out.txt');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe(''); // redirected, not echoed
    expect((await sh.run('cat /out.txt')).stdout).toBe('beta\nbeta two\n');
  });
});

describe('filters drain ctx.stdin when given no FILE', () => {
  it('cat [] reads stdin', async () => {
    const { ctx, out } = ctxWithStdin('hi\nthere\n');
    expect(await cat([], ctx)).toBe(0);
    expect(out()).toBe('hi\nthere\n');
  });

  it('cat - reads stdin', async () => {
    const { ctx, out } = ctxWithStdin('hi\n');
    expect(await cat(['-'], ctx)).toBe(0);
    expect(out()).toBe('hi\n');
  });

  it('cat with neither FILE nor stdin → usage error, exit 1', async () => {
    const { ctx, err } = ctxWithStdin(null);
    expect(await cat([], ctx)).toBe(1);
    expect(err()).toContain('cat: missing argument');
  });

  it('grep PATTERN filters stdin (exit 0 on match, 1 on none)', async () => {
    const hit = ctxWithStdin('alpha\nbeta\n');
    expect(await grep(['beta'], hit.ctx)).toBe(0);
    expect(hit.out()).toBe('beta\n');
    const miss = ctxWithStdin('alpha\n');
    expect(await grep(['zzz'], miss.ctx)).toBe(1);
    expect(miss.out()).toBe('');
  });

  it('wc -l on stdin prints just the count (no label, no trailing space)', async () => {
    const { ctx, out } = ctxWithStdin('a\nb\nc\n');
    expect(await wc(['-l'], ctx)).toBe(0);
    expect(out()).toBe('3\n');
  });

  it('wc -l on empty stdin prints 0', async () => {
    const { ctx, out } = ctxWithStdin('');
    expect(await wc(['-l'], ctx)).toBe(0);
    expect(out()).toBe('0\n');
  });

  it('head/tail read stdin', async () => {
    const h = ctxWithStdin('a\nb\nc\n');
    expect(await head(['-n', '2'], h.ctx)).toBe(0);
    expect(h.out()).toBe('a\nb\n');
    const t = ctxWithStdin('a\nb\nc\n');
    expect(await tail(['-n', '1'], t.ctx)).toBe(0);
    expect(t.out()).toBe('c\n');
  });

  it('a filter with neither FILE nor stdin keeps the usage error', async () => {
    const { ctx } = ctxWithStdin(null);
    expect(await wc(['-l'], ctx)).toBe(1);
  });
});
