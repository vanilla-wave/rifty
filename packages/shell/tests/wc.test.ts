import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
/**
 * `wc` builtin (GNU-faithful). Each test pins ONE behavior the spec calls out:
 * line/word/byte/char counts, the GNU no-trailing-newline edge, the documented
 * `-c` (UTF-8 code units) vs `-m` (code points) divergence, default column
 * order, multi-file total, the missing-file exit code, and that an
 * unimplemented flag throws (never silently ignored).
 *
 * Parity tier: oracle is GNU coreutils `wc` (verified via `gwc` while authoring,
 * not via `node:*` — Node ships no `wc`). Frozen output strings are the contract.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { wc } from '../src/commands/wc.ts';
import { makeCtx } from './_ctx.ts';

afterEach(resetSyncMirror);

/** Install a sync mirror preloaded with `files` (path → UTF-8 contents). */
function withFiles(files: Record<string, string>): void {
  const fs = new MemoryFsSync();
  fs.loadFixture(files);
  setSyncMirror(fs);
}

describe('wc', () => {
  it('-l counts newline characters, NOT lines: a final line without a trailing \\n is not counted (GNU)', async () => {
    withFiles({
      '/two.txt': 'a\nb\n', // 2 newlines -> 2
      '/nonl.txt': 'a\nb', // 1 newline, dangling "b" not counted -> 1
    });
    const a = makeCtx();
    expect(await wc(['-l', '/two.txt'], a.ctx)).toBe(0);
    expect(a.out()).toBe('2 /two.txt\n');

    const b = makeCtx();
    expect(await wc(['-l', '/nonl.txt'], b.ctx)).toBe(0);
    // Field width follows the largest count (1 -> width 1); dangling line uncounted.
    expect(b.out()).toBe('1 /nonl.txt\n');
  });

  it('-w counts whitespace-delimited words (runs of spaces/tabs/newlines collapse)', async () => {
    withFiles({ '/w.txt': '  foo\tbar \n baz  qux\n' }); // foo bar baz qux -> 4
    const { ctx, out } = makeCtx();
    expect(await wc(['-w', '/w.txt'], ctx)).toBe(0);
    expect(out()).toBe('4 /w.txt\n');
  });

  it('-c and -m DIVERGE on a multibyte file: -c = UTF-8 code units (bytes), -m = code points', async () => {
    withFiles({ '/u.txt': 'é\n' }); // 'é' = 2 UTF-8 bytes, 1 code point; + '\n'
    const c = makeCtx();
    expect(await wc(['-c', '/u.txt'], c.ctx)).toBe(0);
    expect(c.out()).toBe('3 /u.txt\n'); // 2 bytes + newline

    const m = makeCtx();
    expect(await wc(['-m', '/u.txt'], m.ctx)).toBe(0);
    expect(m.out()).toBe('2 /u.txt\n'); // 1 char + newline
  });

  it('no flags emits lines, words, bytes in that order, right-justified to the widest count', async () => {
    withFiles({ '/d.txt': 'hello world\nfoo bar baz\n' }); // 2 lines, 5 words, 24 bytes
    const { ctx, out } = makeCtx();
    expect(await wc(['/d.txt'], ctx)).toBe(0);
    // Width = digits of largest count (24 -> 2): ' 2  5 24 /d.txt'.
    expect(out()).toBe(' 2  5 24 /d.txt\n');
  });

  it('multi-file prints a per-file row for each then a total row, all sharing the max-count field width', async () => {
    withFiles({
      '/a.txt': 'hello world\nfoo bar baz\n', // 2 5 24
      '/b.txt': 'one two\n', // 1 2 8
    });
    const { ctx, out } = makeCtx();
    expect(await wc(['/a.txt', '/b.txt'], ctx)).toBe(0);
    // Largest count across files+total is 32 (width 2).
    expect(out()).toBe([' 2  5 24 /a.txt', ' 1  2  8 /b.txt', ' 3  7 32 total', ''].join('\n'));
  });

  it('returns exit 1 and writes to stderr (not stdout) when a file does not exist', async () => {
    withFiles({}); // empty fs
    const { ctx, out, err } = makeCtx();
    expect(await wc(['/missing.txt'], ctx)).toBe(1);
    expect(out()).toBe('');
    expect(err()).not.toBe('');
    expect(err()).toContain('/missing.txt');
  });

  it('returns exit 1 with no file operand (stdin not yet wired)', async () => {
    withFiles({});
    const { ctx, out, err } = makeCtx();
    expect(await wc([], ctx)).toBe(1);
    expect(out()).toBe('');
    expect(err()).not.toBe('');
  });

  it('THROWS NotImplementedError for an unimplemented flag (-L) rather than silently ignoring it', async () => {
    withFiles({ '/d.txt': 'x\n' });
    const { ctx } = makeCtx();
    await expect(wc(['-L', '/d.txt'], ctx)).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'shell.wc.-L',
    });
  });
});
