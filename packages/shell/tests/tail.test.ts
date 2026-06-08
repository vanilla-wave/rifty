import { NotImplementedError } from '@riftydev/io';
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';
import { tail } from '../src/commands/tail.ts';
import { makeCtx } from './_ctx.ts';

/** Seed the active sync mirror with `files` and install it. */
function seed(files: Record<string, string>): void {
  const fs = new MemoryFsSync();
  fs.loadFixture(files);
  setSyncMirror(fs);
}

afterEach(resetSyncMirror);

describe('tail', () => {
  it('-n 3 emits only the last 3 lines (not the default 10)', async () => {
    // Failure mode: ignoring -n N and printing the default 10 / wrong slice.
    seed({ '/f': 'l1\nl2\nl3\nl4\nl5\n' });
    const { ctx, out, err } = makeCtx();
    const code = await tail(['-n', '3', '/f'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('l3\nl4\nl5\n');
    expect(err()).toBe('');
  });

  it('-n +2 prints FROM line 2 to end, not the LAST 2 lines (MD-04 +N)', async () => {
    // Failure mode: treating +N like N (last-2) instead of from-line-N.
    seed({ '/f': 'l1\nl2\nl3\nl4\nl5\n' });
    const { ctx, out } = makeCtx();
    const code = await tail(['-n', '+2', '/f'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('l2\nl3\nl4\nl5\n');
  });

  it('default prints the last 10 lines', async () => {
    // Failure mode: wrong default count.
    const lines = Array.from({ length: 15 }, (_, i) => `n${i + 1}`).join('\n');
    seed({ '/f': `${lines}\n` });
    const { ctx, out } = makeCtx();
    const code = await tail(['/f'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe(`${Array.from({ length: 10 }, (_, i) => `n${i + 6}`).join('\n')}\n`);
  });

  it('-c 4 emits exactly the last 4 bytes', async () => {
    // Failure mode: byte mode confused with line mode, or off-by-one slice.
    seed({ '/f': 'l1\nl2\nl3\nl4\nl5\n' });
    const { ctx, out } = makeCtx();
    const code = await tail(['-c', '4', '/f'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('\nl5\n');
  });

  it('-c +4 emits FROM byte 4 to end (1-based)', async () => {
    // Failure mode: +N byte offset treated as last-N bytes.
    seed({ '/f': 'l1\nl2\nl3\nl4\nl5\n' });
    const { ctx, out } = makeCtx();
    const code = await tail(['-c', '+4', '/f'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('l2\nl3\nl4\nl5\n');
  });

  it('a file ending WITHOUT a newline yields no phantom blank line', async () => {
    // Failure mode: splitting on \n produces a trailing empty element printed as a blank line.
    seed({ '/f': 'a\nb\nc' });
    const { ctx, out } = makeCtx();
    const code = await tail(['-n', '2', '/f'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('b\nc');
  });

  it('emits ==> NAME <== headers between multiple files', async () => {
    // Failure mode: no headers / wrong separator for multi-file output (head-style).
    seed({ '/a': 'a1\na2\n', '/b': 'b1\nb2\n' });
    const { ctx, out } = makeCtx();
    const code = await tail(['/a', '/b'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('==> /a <==\na1\na2\n\n==> /b <==\nb1\nb2\n');
  });

  it('-q suppresses headers even with multiple files', async () => {
    // Failure mode: -q ignored.
    seed({ '/a': 'a1\n', '/b': 'b1\n' });
    const { ctx, out } = makeCtx();
    const code = await tail(['-q', '/a', '/b'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('a1\nb1\n');
  });

  it('-v forces a header for a single file', async () => {
    // Failure mode: -v ignored (single file normally headerless).
    seed({ '/a': 'a1\n' });
    const { ctx, out } = makeCtx();
    const code = await tail(['-v', '/a'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('==> /a <==\na1\n');
  });

  it('returns 1 and writes to stderr for a missing file', async () => {
    // Failure mode: missing file silently ignored or exits 0.
    seed({});
    const { ctx, out, err } = makeCtx();
    const code = await tail(['/nope'], ctx);
    expect(code).toBe(1);
    expect(out()).toBe('');
    expect(err()).toContain('/nope');
  });

  it('processes good files but exits 1 when one operand is missing', async () => {
    // Failure mode: aborting on first error, or exiting 0 despite a failure.
    seed({ '/a': 'a1\n' });
    const { ctx, out, err } = makeCtx();
    const code = await tail(['/a', '/nope'], ctx);
    expect(code).toBe(1);
    expect(out()).toContain('a1\n');
    expect(err()).toContain('/nope');
  });

  it('-f throws NotImplementedError (no polling loop)', async () => {
    // Failure mode: silently ignoring -f instead of throwing the loud stub.
    seed({ '/a': 'a1\n' });
    const { ctx } = makeCtx();
    await expect(tail(['-f', '/a'], ctx)).rejects.toBeInstanceOf(NotImplementedError);
  });

  it('rejects an invalid line count with exit 1 on stderr', async () => {
    // Failure mode: NaN count parsed as 0/10 instead of a usage error.
    seed({ '/a': 'a1\n' });
    const { ctx, out, err } = makeCtx();
    const code = await tail(['-n', 'abc', '/a'], ctx);
    expect(code).toBe(1);
    expect(out()).toBe('');
    expect(err()).toContain('invalid number of lines');
  });
});
