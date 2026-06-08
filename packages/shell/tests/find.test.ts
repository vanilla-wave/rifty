/**
 * Tests for the `find` builtin. Each case pins a specific failure mode:
 * the root '.' is emitted first (GNU style) and child paths are joined onto the
 * start path AS GIVEN (./a, not absolutized), -name matches the basename via
 * matchSegment, -type f/d filters, -maxdepth bounds descent, a missing start
 * path is exit 1, and an unimplemented flag throws loudly.
 *
 * FIXTURE NOTE: gfind (GNU findutils) is not installed on this box, so there is
 * NO frozen GNU fixture for find. These are hand-asserted conformance cases
 * pinned to known GNU behavior. See parityOrFixtureFollowup for the deferral.
 */

import { NotImplementedError } from '@riftydev/io';
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { find } from '../src/commands/find.ts';
import { makeCtx } from './_ctx.ts';

const enc = new TextEncoder();

/** Expected stdout: each line terminated by '\n' (GNU prints one path per line). */
function lines(...paths: string[]): string {
  return paths.map((p) => `${p}\n`).join('');
}

/**
 * Install a fresh in-memory mirror seeded with files (dirs auto-created). A
 * key ending in '/' seeds an (otherwise empty) directory.
 */
function seed(entries: Record<string, string>): void {
  const fs = new MemoryFsSync();
  for (const [path, content] of Object.entries(entries)) {
    if (path.endsWith('/')) {
      fs.mkdirSync(path.replace(/\/+$/, '') || '/', { recursive: true });
      continue;
    }
    const dir = path.slice(0, path.lastIndexOf('/')) || '/';
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path, enc.encode(content));
  }
  setSyncMirror(fs);
}

/** Standard nested tree under /proj used by most cases. */
function seedTree(): void {
  seed({
    '/proj/a.ts': 'A',
    '/proj/b.txt': 'B',
    '/proj/sub/c.ts': 'C',
    '/proj/sub/d.md': 'D',
    '/proj/empty/': '',
  });
}

beforeEach(() => resetSyncMirror());
afterEach(() => resetSyncMirror());

it('bare find lists the root "." first then every descendant (GNU join, not absolutized)', async () => {
  // Failure mode: omitting the root, absolutizing children, or wrong order/join.
  seedTree();
  const { ctx, out, err } = makeCtx({ cwd: '/proj' });
  const code = await find([], ctx);
  expect(code).toBe(0);
  expect(err()).toBe('');
  // Depth-first, byte-sorted within each dir (walk's contract). Root '.' first.
  expect(out()).toBe(
    lines('.', './a.ts', './b.txt', './empty', './sub', './sub/c.ts', './sub/d.md'),
  );
});

it('an explicit start path is preserved verbatim in every emitted path', async () => {
  // Failure mode: rewriting the given path to its absolute/normalized form.
  seedTree();
  const { ctx, out } = makeCtx({ cwd: '/proj' });
  const code = await find(['sub'], ctx);
  expect(code).toBe(0);
  expect(out()).toBe(lines('sub', 'sub/c.ts', 'sub/d.md'));
});

it('-name GLOB matches the basename via matchSegment', async () => {
  // Failure mode: matching against the whole path, or ignoring the glob.
  seedTree();
  const { ctx, out } = makeCtx({ cwd: '/proj' });
  const code = await find(['.', '-name', '*.ts'], ctx);
  expect(code).toBe(0);
  // Only .ts basenames; the root '.' does not match '*.ts'.
  expect(out()).toBe(lines('./a.ts', './sub/c.ts'));
});

it('-type d lists directories only (including the root)', async () => {
  // Failure mode: including files, or dropping the root dir.
  seedTree();
  const { ctx, out } = makeCtx({ cwd: '/proj' });
  const code = await find(['.', '-type', 'd'], ctx);
  expect(code).toBe(0);
  expect(out()).toBe(lines('.', './empty', './sub'));
});

it('-type f lists files only (root dir excluded)', async () => {
  // Failure mode: including directories or the root.
  seedTree();
  const { ctx, out } = makeCtx({ cwd: '/proj' });
  const code = await find(['.', '-type', 'f'], ctx);
  expect(code).toBe(0);
  expect(out()).toBe(lines('./a.ts', './b.txt', './sub/c.ts', './sub/d.md'));
});

it('-maxdepth 1 emits the root (depth 0) and direct children (depth 1) only', async () => {
  // Failure mode: descending into sub/ (depth 2) despite the cap.
  seedTree();
  const { ctx, out } = makeCtx({ cwd: '/proj' });
  const code = await find(['.', '-maxdepth', '1'], ctx);
  expect(code).toBe(0);
  expect(out()).toBe(lines('.', './a.ts', './b.txt', './empty', './sub'));
});

it('-mindepth 1 suppresses the root (depth 0)', async () => {
  // Failure mode: emitting the start path despite the lower bound.
  seedTree();
  const { ctx, out } = makeCtx({ cwd: '/proj' });
  const code = await find(['.', '-mindepth', '1', '-maxdepth', '1'], ctx);
  expect(code).toBe(0);
  expect(out()).toBe(lines('./a.ts', './b.txt', './empty', './sub'));
});

it('multiple start paths are each walked, in argument order', async () => {
  // Failure mode: only walking the first path, or merging/sorting across roots.
  seedTree();
  const { ctx, out } = makeCtx({ cwd: '/proj' });
  const code = await find(['empty', 'sub'], ctx);
  expect(code).toBe(0);
  expect(out()).toBe(lines('empty', 'sub', 'sub/c.ts', 'sub/d.md'));
});

it('a nonexistent start path: stderr No such file or directory, exit 1', async () => {
  // Failure mode: swallowing ENOENT or a non-1 exit (corrupts && chains).
  seedTree();
  const { ctx, out, err } = makeCtx({ cwd: '/proj' });
  const code = await find(['nope'], ctx);
  expect(code).toBe(1);
  expect(out()).toBe('');
  expect(err()).toBe("find: 'nope': No such file or directory\n");
});

it('a missing path still lets a valid path emit, but exit stays 1', async () => {
  // Failure mode: aborting the whole run on the first bad path.
  seedTree();
  const { ctx, out, err } = makeCtx({ cwd: '/proj' });
  const code = await find(['nope', 'empty'], ctx);
  expect(code).toBe(1);
  expect(out()).toBe('empty\n');
  expect(err()).toBe("find: 'nope': No such file or directory\n");
});

it('-exec (and the other unimplemented predicates) throws NotImplementedError', async () => {
  // Failure mode: silently ignoring -exec (a destructive no-op lie).
  seedTree();
  const { ctx } = makeCtx({ cwd: '/proj' });
  await expect(find(['.', '-exec', 'rm', '{}', ';'], ctx)).rejects.toBeInstanceOf(
    NotImplementedError,
  );
});

it('an unknown -flag throws rather than being silently ignored', async () => {
  // Failure mode: treating an unrecognized predicate as a harmless no-op.
  seedTree();
  const { ctx } = makeCtx({ cwd: '/proj' });
  await expect(find(['.', '-size', '+1k'], ctx)).rejects.toBeInstanceOf(NotImplementedError);
});
