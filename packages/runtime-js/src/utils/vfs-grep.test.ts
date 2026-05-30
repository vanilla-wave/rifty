/**
 * Unit coverage for the pure-JS VFS grep marker tool (F09 D1,
 * Q-2026-05-30-061). The marker walks the VFS via the existing `node:fs`
 * builtin and matches lines with the JS RegExp engine — in-realm, ZERO process
 * spawn. This first case pins the 1-based line/column convention (ripgrep/Node
 * grep output), the off-by-one trap flagged in the feature doc.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { resetSyncMirror } from '../builtins/fs-sync-mirror.ts';
import { mkdirSync, writeFileSync } from '../builtins/fs.ts';
import { vfsGrep } from './vfs-grep.ts';

afterEach(() => resetSyncMirror());

describe('vfsGrep — pure-JS VFS search marker (Q-2026-05-30-061)', () => {
  it('vfsGrep returns 1-based line and column for a known match', () => {
    mkdirSync('/work', { recursive: true });
    writeFileSync('/work/x.ts', 'const foo = 1\nconst bar = 2');
    expect(vfsGrep('bar', '/work')).toEqual([
      { path: '/work/x.ts', line: 2, column: 7, text: 'const bar = 2' },
    ]);
  });

  // Failure-mode contract: an unbounded walk would scan all 5 files and return
  // 5 matches. `maxResults` must bound the walk and stop at exactly 2.
  it('vfsGrep stops at maxResults', () => {
    mkdirSync('/work', { recursive: true });
    for (let i = 0; i < 5; i++) {
      writeFileSync(`/work/f${i}.ts`, 'needle here');
    }
    const result = vfsGrep('needle', '/work', { maxResults: 2 });
    expect(result.length).toBe(2);
  });

  // Failure-mode contract: a case-sensitive scan would miss `NEEDLE`/`Needle`;
  // `ignoreCase` must match them all.
  it('vfsGrep ignoreCase matches mixed case', () => {
    mkdirSync('/work', { recursive: true });
    writeFileSync('/work/a.ts', 'NEEDLE on line one\nneedle on line two\nNeEdLe on line three');
    const result = vfsGrep('needle', '/work', { ignoreCase: true });
    expect(result.map((m) => m.line)).toEqual([1, 2, 3]);
  });

  // Failure-mode contract: without an include filter the walk would also open
  // `/work/x.md`; `include:'*.ts'` must restrict scanning to `.ts` paths only.
  it('vfsGrep include filter only scans matching paths', () => {
    mkdirSync('/work', { recursive: true });
    writeFileSync('/work/x.ts', 'match ts');
    writeFileSync('/work/x.md', 'match md');
    const result = vfsGrep('match', '/work', { include: '*.ts' });
    expect(result.map((m) => m.path)).toEqual(['/work/x.ts']);
  });

  // Failure-mode contract: recursion must descend into subdirectories, not just
  // scan the top level — a non-recursive walk would miss `/work/sub/deep.ts`.
  it('vfsGrep descends recursively into subdirectories', () => {
    mkdirSync('/work/sub', { recursive: true });
    writeFileSync('/work/top.ts', 'token A');
    writeFileSync('/work/sub/deep.ts', 'token B');
    const result = vfsGrep('token', '/work');
    expect(result.map((m) => m.path).sort()).toEqual(['/work/sub/deep.ts', '/work/top.ts']);
  });

  // Failure-mode contract: a missing root must surface the underlying node:fs
  // ENOENT, NOT be swallowed into an empty result (no silent stub).
  it('vfsGrep throws ENOENT for a missing root', () => {
    expect(() => vfsGrep('x', '/nope')).toThrow(expect.objectContaining({ code: 'ENOENT' }));
  });
});
