/**
 * Tests for the shared recursive tree-walker (`grep -r` / `find` foundation).
 * Each case pins a specific failure mode: deterministic name-sorted DFS order,
 * 1-based child depth, maxDepth pruning, includeDirs toggle, files-only default,
 * and propagation of a VfsError from a bad root.
 *
 * Seeded tree (under '/'):
 *   a/            (dir)
 *   a/b.txt       'B'
 *   a/c/          (dir)
 *   a/c/d.txt     'D'
 *   e.txt         'E'
 */

import { VfsError } from '@riftydev/vfs';
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { walk } from '../src/commands/_walk.ts';

const enc = new TextEncoder();

function seed(): void {
  const fs = new MemoryFsSync();
  fs.mkdirSync('/a/c', { recursive: true });
  fs.writeFileSync('/a/b.txt', enc.encode('B'));
  fs.writeFileSync('/a/c/d.txt', enc.encode('D'));
  fs.writeFileSync('/e.txt', enc.encode('E'));
  setSyncMirror(fs);
}

beforeEach(() => {
  resetSyncMirror();
  seed();
});
afterEach(() => resetSyncMirror());

it('yields files in deterministic name-sorted DFS order, root NOT yielded', () => {
  // Failure mode: nondeterministic backend order, or emitting the root itself.
  const paths = [...walk('/')].map((e) => e.path);
  expect(paths).toEqual(['/a/b.txt', '/a/c/d.txt', '/e.txt']);
});

it('assigns depth 1 to direct children, deeper for nested entries', () => {
  // Failure mode: 0-based depth, or not incrementing on recursion.
  const byPath = new Map([...walk('/', { includeDirs: true })].map((e) => [e.path, e.depth]));
  expect(byPath.get('/a')).toBe(1);
  expect(byPath.get('/a/b.txt')).toBe(2);
  expect(byPath.get('/a/c')).toBe(2);
  expect(byPath.get('/a/c/d.txt')).toBe(3);
  expect(byPath.get('/e.txt')).toBe(1);
});

it('maxDepth:1 stops at direct children (no descent into a/)', () => {
  // Failure mode: descending past the cap (would surface /a/b.txt etc).
  const paths = [...walk('/', { maxDepth: 1, includeDirs: true })].map((e) => e.path);
  expect(paths).toEqual(['/a', '/e.txt']);
});

it('includeDirs surfaces directory entries interleaved with files', () => {
  // Failure mode: dropping dirs even when includeDirs requested.
  const entries = [...walk('/', { includeDirs: true })];
  expect(entries.map((e) => e.path)).toEqual(['/a', '/a/b.txt', '/a/c', '/a/c/d.txt', '/e.txt']);
  const a = entries.find((e) => e.path === '/a');
  expect(a?.isDirectory).toBe(true);
  expect(a?.name).toBe('a');
});

it('files-only by default: directories descended into but not yielded', () => {
  // Failure mode: leaking dir entries when includeDirs is absent/false.
  const entries = [...walk('/')];
  expect(entries.every((e) => !e.isDirectory)).toBe(true);
  expect(entries.map((e) => e.name)).toEqual(['b.txt', 'd.txt', 'e.txt']);
});

it('propagates a VfsError when the root does not exist', () => {
  // Failure mode: swallowing ENOENT (caller can no longer map it to stderr/exit).
  expect(() => [...walk('/nope')]).toThrow(VfsError);
});
