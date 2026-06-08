/**
 * Tests for the `grep` builtin. Each case pins a specific failure mode from the
 * spec: basic match, -n line numbers, -i case-fold, -v invert, -c count-only,
 * -l filename-only, -r recursion (proves walk() use), the GNU exit tri-state
 * (0 matched / 1 no-match / 2 error), -F literal escaping, the JS-RegExp
 * divergence, multi-file `name:` prefixing, and the loud throw for an
 * unimplemented flag. Backed by an in-memory mirror so reads exercise real
 * ENOENT paths.
 *
 * No frozen-GNU fixture: ggrep is not installed here, so these are rigorous
 * hand-asserted conformance tests against documented GNU behavior (see the
 * structured output's parityOrFixtureFollowup).
 */

import { NotImplementedError } from '@riftydev/io';
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { grep } from '../src/commands/grep.ts';
import { makeCtx } from './_ctx.ts';

const enc = new TextEncoder();

/** Install a fresh in-memory mirror seeded with `files`. */
function seed(files: Record<string, string>): void {
  const fs = new MemoryFsSync();
  for (const [path, content] of Object.entries(files)) {
    const dir = path.slice(0, path.lastIndexOf('/')) || '/';
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path, enc.encode(content));
  }
  setSyncMirror(fs);
}

beforeEach(() => resetSyncMirror());
afterEach(() => resetSyncMirror());

it('prints matching lines (single file: no filename prefix), exit 0', async () => {
  // Failure mode: prefixing a lone file, printing non-matches, or wrong exit.
  seed({ '/f.txt': 'apple\nbanana\napricot\n' });
  const { ctx, out, err } = makeCtx();
  const code = await grep(['ap', '/f.txt'], ctx);
  expect(code).toBe(0);
  expect(out()).toBe('apple\napricot\n');
  expect(err()).toBe('');
});

it('-n prepends 1-based line numbers as "lineno:line"', async () => {
  // Failure mode: 0-based numbering, or counting only matched lines.
  seed({ '/f.txt': 'apple\nbanana\napricot\n' });
  const { ctx, out } = makeCtx();
  const code = await grep(['-n', 'ap', '/f.txt'], ctx);
  expect(code).toBe(0);
  expect(out()).toBe('1:apple\n3:apricot\n');
});

it('-i matches case-insensitively', async () => {
  // Failure mode: case-sensitive compile despite -i.
  seed({ '/f.txt': 'Apple\nBANANA\n' });
  const { ctx, out } = makeCtx();
  const code = await grep(['-i', 'apple', '/f.txt'], ctx);
  expect(code).toBe(0);
  expect(out()).toBe('Apple\n');
});

it('-v inverts: prints lines that do NOT match', async () => {
  // Failure mode: inverting the exit but not the line selection (or vice versa).
  seed({ '/f.txt': 'apple\nbanana\napricot\n' });
  const { ctx, out } = makeCtx();
  const code = await grep(['-v', 'ap', '/f.txt'], ctx);
  expect(code).toBe(0);
  expect(out()).toBe('banana\n');
});

it('-c prints only a per-file match count (not the lines)', async () => {
  // Failure mode: emitting lines, or counting matches-per-line not lines.
  seed({ '/f.txt': 'apple\nbanana\napricot\n' });
  const { ctx, out } = makeCtx();
  const code = await grep(['-c', 'ap', '/f.txt'], ctx);
  expect(code).toBe(0);
  expect(out()).toBe('2\n');
});

it('-c with no match prints "0" and exits 1 (count is not "found")', async () => {
  // Failure mode: exit 0 just because -c always writes a line.
  seed({ '/f.txt': 'apple\n' });
  const { ctx, out } = makeCtx();
  const code = await grep(['-c', 'zzz', '/f.txt'], ctx);
  expect(code).toBe(1);
  expect(out()).toBe('0\n');
});

it('-l prints only filenames that have >=1 match', async () => {
  // Failure mode: printing the lines, or listing a file with zero matches.
  seed({ '/hit.txt': 'apple\n', '/miss.txt': 'pear\n' });
  const { ctx, out } = makeCtx();
  const code = await grep(['-l', 'apple', '/hit.txt', '/miss.txt'], ctx);
  expect(code).toBe(0);
  expect(out()).toBe('/hit.txt\n');
});

it('multiple files: each match line is prefixed "filename:"', async () => {
  // Failure mode: no prefix with >1 file (ambiguous which file matched).
  seed({ '/a.txt': 'apple\n', '/b.txt': 'apricot\npear\n' });
  const { ctx, out } = makeCtx();
  const code = await grep(['ap', '/a.txt', '/b.txt'], ctx);
  expect(code).toBe(0);
  expect(out()).toBe('/a.txt:apple\n/b.txt:apricot\n');
});

it('-H forces the "filename:" prefix even for a single file', async () => {
  // Failure mode: honoring multi-file prefix rule but ignoring explicit -H.
  seed({ '/f.txt': 'apple\n' });
  const { ctx, out } = makeCtx();
  const code = await grep(['-H', 'apple', '/f.txt'], ctx);
  expect(code).toBe(0);
  expect(out()).toBe('/f.txt:apple\n');
});

it('-n with a prefix orders fields as "filename:lineno:line"', async () => {
  // Failure mode: swapping the name/lineno order (GNU is name first).
  seed({ '/f.txt': 'x\napple\n' });
  const { ctx, out } = makeCtx();
  const code = await grep(['-Hn', 'apple', '/f.txt'], ctx);
  expect(code).toBe(0);
  expect(out()).toBe('/f.txt:2:apple\n');
});

it('-r recurses a nested tree (files-only), prefixing each match (proves walk())', async () => {
  // Failure mode: not descending, or not using walk()'s deterministic order.
  seed({
    '/d/a.txt': 'apple\npear\n',
    '/d/sub/b.txt': 'apricot\n',
    '/d/sub/c.txt': 'pear\n',
  });
  const { ctx, out } = makeCtx();
  const code = await grep(['-r', 'ap', '/d'], ctx);
  expect(code).toBe(0);
  // walk() is name-sorted DFS: /d/a.txt before /d/sub/*. -r implies filename prefix.
  expect(out()).toBe('/d/a.txt:apple\n/d/sub/b.txt:apricot\n');
});

it('-r with no path argument defaults to "." and prints paths as-given (GNU-relative)', async () => {
  // Failure mode: erroring on a missing path, or printing the ABSOLUTE resolved
  // path instead of the start-path-as-given './a.txt' (GNU / find behaviour).
  seed({ '/work/a.txt': 'apple\n' });
  const { ctx, out } = makeCtx({ cwd: '/work' });
  const code = await grep(['-r', 'apple'], ctx);
  expect(code).toBe(0);
  expect(out()).toBe('./a.txt:apple\n');
});

it('-r with a RELATIVE dir root prints matches under that root as-given', async () => {
  // Locks the as-given join: root 'd' (not absolutized) -> 'd/a.txt', 'd/sub/b.txt'.
  seed({ '/d/a.txt': 'apple\n', '/d/sub/b.txt': 'apricot\n' });
  const { ctx, out } = makeCtx({ cwd: '/' });
  const code = await grep(['-r', 'ap', 'd'], ctx);
  expect(code).toBe(0);
  expect(out()).toBe('d/a.txt:apple\nd/sub/b.txt:apricot\n');
});

it('-R is an alias for -r', async () => {
  // Failure mode: only honoring -r, throwing/ignoring the equally-valid -R.
  seed({ '/d/a.txt': 'apple\n' });
  const { ctx, out } = makeCtx();
  const code = await grep(['-R', 'apple', '/d'], ctx);
  expect(code).toBe(0);
  expect(out()).toBe('/d/a.txt:apple\n');
});

it('PATTERN is a JS RegExp: metacharacters are active (documented divergence)', async () => {
  // Failure mode: treating the pattern as a literal (would miss the regex match).
  seed({ '/f.txt': 'cat\ncot\ncut\n' });
  const { ctx, out } = makeCtx();
  const code = await grep(['c[au]t', '/f.txt'], ctx);
  expect(code).toBe(0);
  expect(out()).toBe('cat\ncut\n');
});

it('-F forces literal: regex metachars match themselves', async () => {
  // Failure mode: compiling "a.c" as a regex (would match "abc").
  seed({ '/f.txt': 'a.c\nabc\n' });
  const { ctx, out } = makeCtx();
  const code = await grep(['-F', 'a.c', '/f.txt'], ctx);
  expect(code).toBe(0);
  expect(out()).toBe('a.c\n');
});

it('no match: nothing printed, exit 1 (clean no-match, not an error)', async () => {
  // Failure mode: exit 0 (would break `grep ... && ...` chains) or exit 2.
  seed({ '/f.txt': 'apple\n' });
  const { ctx, out, err } = makeCtx();
  const code = await grep(['zzz', '/f.txt'], ctx);
  expect(code).toBe(1);
  expect(out()).toBe('');
  expect(err()).toBe('');
});

it('missing path: stderr error, exit 2 (error trumps no-match)', async () => {
  // Failure mode: exit 1 (no-match) instead of 2 (error) on an unreadable path.
  seed({});
  const { ctx, out, err } = makeCtx();
  const code = await grep(['apple', '/nope.txt'], ctx);
  expect(code).toBe(2);
  expect(out()).toBe('');
  expect(err()).toBe('grep: /nope.txt: No such file or directory\n');
});

it('invalid regex: stderr error, exit 2', async () => {
  // Failure mode: a malformed pattern throwing/crashing instead of exit 2.
  seed({ '/f.txt': 'apple\n' });
  const { ctx, out, err } = makeCtx();
  const code = await grep(['[', '/f.txt'], ctx);
  expect(code).toBe(2);
  expect(out()).toBe('');
  expect(err()).not.toBe('');
});

it('no FILE, no -r, no stdin connected: error exit 2 (stdin mode is M12)', async () => {
  // Failure mode: silently stubbing stdin-filter mode, or exit 0/1.
  seed({});
  const { ctx, out, err } = makeCtx();
  const code = await grep(['apple'], ctx);
  expect(code).toBe(2);
  expect(out()).toBe('');
  expect(err()).not.toBe('');
});

it('a partial error still reports matches from good files but exits 2', async () => {
  // Failure mode: an error on one file masking matches in another (or exit 1).
  seed({ '/ok.txt': 'apple\n' });
  const { ctx, out, err } = makeCtx();
  const code = await grep(['apple', '/ok.txt', '/nope.txt'], ctx);
  expect(code).toBe(2);
  expect(out()).toBe('/ok.txt:apple\n');
  expect(err()).toBe('grep: /nope.txt: No such file or directory\n');
});

it('-E (and other unimplemented flags) throws NotImplementedError', async () => {
  // Failure mode: silently treating -E like the default JS-regex engine.
  seed({ '/f.txt': 'apple\n' });
  const { ctx } = makeCtx();
  await expect(grep(['-E', 'a', '/f.txt'], ctx)).rejects.toBeInstanceOf(NotImplementedError);
});

it('-w (long-form unimplemented) throws NotImplementedError', async () => {
  // Failure mode: silently ignoring a word-boundary flag we don't support.
  seed({ '/f.txt': 'apple\n' });
  const { ctx } = makeCtx();
  await expect(grep(['-w', 'a', '/f.txt'], ctx)).rejects.toBeInstanceOf(NotImplementedError);
});
