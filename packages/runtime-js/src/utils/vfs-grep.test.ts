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
});
