import { NotImplementedError } from '@riftydev/io';
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
/**
 * Unit tests for the `head` builtin. Each case pins one specific failure mode
 * from the spec; none weaken GNU parity.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { head } from '../src/commands/head.ts';
import { makeCtx } from './_ctx.ts';

/** Seed the active sync mirror with `files` and return it. */
function seed(files: Record<string, string>): MemoryFsSync {
  const vfs = new MemoryFsSync();
  vfs.loadFixture(files);
  setSyncMirror(vfs);
  return vfs;
}

afterEach(() => {
  resetSyncMirror();
});

describe('head', () => {
  it('defaults to the first 10 lines', async () => {
    // Failure mode: wrong default count (e.g. all lines, or first N≠10).
    const lines = Array.from({ length: 15 }, (_, i) => `line${i + 1}`).join('\n');
    seed({ '/f.txt': `${lines}\n` });
    const { ctx, out, err } = makeCtx();
    const code = await head(['/f.txt'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe(`${Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join('\n')}\n`);
    expect(err()).toBe('');
  });

  it('-n 3 emits the first 3 lines', async () => {
    // Failure mode: off-by-one or ignoring the explicit count.
    seed({ '/f.txt': 'a\nb\nc\nd\ne\n' });
    const { ctx, out } = makeCtx();
    const code = await head(['-n', '3', '/f.txt'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('a\nb\nc\n');
  });

  it('-n -2 emits all but the last 2 lines (negative N, MD-04)', async () => {
    // Failure mode: negative-N not handled, or off-by-one at the tail.
    seed({ '/f.txt': 'a\nb\nc\nd\ne\n' });
    const { ctx, out } = makeCtx();
    const code = await head(['-n', '-2', '/f.txt'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('a\nb\nc\n');
  });

  it('-n 0 produces no output', async () => {
    // Failure mode: treating 0 as "default 10" or emitting one line.
    seed({ '/f.txt': 'a\nb\nc\n' });
    const { ctx, out, err } = makeCtx();
    const code = await head(['-n', '0', '/f.txt'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('');
    expect(err()).toBe('');
  });

  it('-c 5 emits the first 5 BYTES, not 5 characters', async () => {
    // Failure mode: counting Unicode code points instead of bytes. "héllo":
    // é is 2 UTF-8 bytes, so 5 bytes = "h" + "é"(2) + "ll" = "héll".
    seed({ '/f.txt': 'héllo world\n' });
    const { ctx, out } = makeCtx();
    const code = await head(['-c', '5', '/f.txt'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('héll');
  });

  it('-c -3 emits all but the last 3 bytes', async () => {
    // Failure mode: negative byte count not handled.
    seed({ '/f.txt': 'abcdef' });
    const { ctx, out } = makeCtx();
    const code = await head(['-c', '-3', '/f.txt'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('abc');
  });

  it('prints "==> name <==" headers with a blank separator between files', async () => {
    // Failure mode: missing/wrong multi-file headers or separator placement.
    seed({ '/a.txt': 'a1\na2\n', '/b.txt': 'b1\n' });
    const { ctx, out } = makeCtx();
    const code = await head(['-n', '1', '/a.txt', '/b.txt'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('==> /a.txt <==\na1\n\n==> /b.txt <==\nb1\n');
  });

  it('-q suppresses headers even for multiple files', async () => {
    // Failure mode: honoring multi-file header default when -q is given.
    seed({ '/a.txt': 'a1\n', '/b.txt': 'b1\n' });
    const { ctx, out } = makeCtx();
    const code = await head(['-q', '-n', '1', '/a.txt', '/b.txt'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('a1\nb1\n');
  });

  it('-v forces a header for a single file', async () => {
    // Failure mode: header gated only on file count, ignoring -v.
    seed({ '/f.txt': 'x\n' });
    const { ctx, out } = makeCtx();
    const code = await head(['-v', '/f.txt'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('==> /f.txt <==\nx\n');
  });

  it('reports a missing file to stderr and exits 1', async () => {
    // Failure mode: swallowing ENOENT or exiting 0.
    seed({ '/a.txt': 'a1\n' });
    const { ctx, out, err } = makeCtx();
    const code = await head(['/a.txt', '/nope.txt'], ctx);
    expect(code).toBe(1);
    // Existing file still printed (with header, since multi-file).
    expect(out()).toContain('a1');
    expect(err()).toContain('/nope.txt');
  });

  it('rejects a non-integer count on stderr with exit 1 (not a thrown error)', async () => {
    // Failure mode: NaN count silently slicing 0/all, or an uncaught throw that
    // breaks the &&/|| exit-code contract.
    seed({ '/f.txt': 'a\nb\n' });
    const { ctx, out, err } = makeCtx();
    const code = await head(['-n', 'xyz', '/f.txt'], ctx);
    expect(code).toBe(1);
    expect(out()).toBe('');
    expect(err()).toContain('invalid number of lines');
  });

  it('throws NotImplementedError for -z', async () => {
    // Failure mode: silently ignoring an unimplemented flag (worse than throwing).
    seed({ '/f.txt': 'a\nb\n' });
    const { ctx } = makeCtx();
    await expect(head(['-z', '/f.txt'], ctx)).rejects.toBeInstanceOf(NotImplementedError);
  });
});
