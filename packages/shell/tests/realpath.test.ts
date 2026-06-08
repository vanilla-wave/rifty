/**
 * Tests for the `realpath` builtin. VFS has no symlinks (ADR-0050), so realpath
 * is "normalized ABSOLUTE path of an existing path" (MD-05). Each case pins a
 * GNU-faithful contract from the spec.
 */

import { NotImplementedError } from '@riftydev/io';
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { realpath } from '../src/commands/realpath.ts';
import { makeCtx } from './_ctx.ts';

const enc = new TextEncoder();

/** Install a fresh in-memory mirror seeded with `files` before each test. */
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

it('normalizes ./a/../b against cwd to an absolute path for an existing target', async () => {
  // Failure mode: failing to collapse `.`/`..` segments or to absolutize against cwd.
  seed({ '/work/b': 'x' });
  const { ctx, out, err } = makeCtx({ cwd: '/work' });
  const code = await realpath(['./a/../b'], ctx);
  expect(code).toBe(0);
  expect(out()).toBe('/work/b\n');
  expect(err()).toBe('');
});

it('prints the normalized absolute path of an existing path, exit 0', async () => {
  // Failure mode: not resolving a relative operand against cwd.
  seed({ '/home/user/file.txt': 'data' });
  const { ctx, out, err } = makeCtx({ cwd: '/home/user' });
  const code = await realpath(['file.txt'], ctx);
  expect(code).toBe(0);
  expect(out()).toBe('/home/user/file.txt\n');
  expect(err()).toBe('');
});

it('default mode: a missing path errors to stderr and exits 1, no stdout', async () => {
  // Failure mode: silently emitting a path for a nonexistent target (default requires existence).
  seed({});
  const { ctx, out, err } = makeCtx({ cwd: '/work' });
  const code = await realpath(['nope.txt'], ctx);
  expect(code).toBe(1);
  expect(out()).toBe('');
  expect(err()).toBe('realpath: nope.txt: No such file or directory\n');
});

it('-m: a missing path is allowed — normalized + exit 0', async () => {
  // Failure mode: enforcing existence even under -m (pure-normalize mode).
  seed({});
  const { ctx, out, err } = makeCtx({ cwd: '/work' });
  const code = await realpath(['-m', './x/../y/z'], ctx);
  expect(code).toBe(0);
  expect(out()).toBe('/work/y/z\n');
  expect(err()).toBe('');
});

it('-e (explicit) requires existence like the default and exits 1 when missing', async () => {
  // Failure mode: -e not requesting existence (it is the default semantics, made explicit).
  seed({});
  const { ctx, out, err } = makeCtx({ cwd: '/work' });
  const code = await realpath(['-e', 'gone'], ctx);
  expect(code).toBe(1);
  expect(out()).toBe('');
  expect(err()).toBe('realpath: gone: No such file or directory\n');
});

it('-q suppresses the error message for a missing path but still exits 1', async () => {
  // Failure mode: -q changing the exit code, or not suppressing the diagnostic.
  seed({});
  const { ctx, out, err } = makeCtx({ cwd: '/work' });
  const code = await realpath(['-q', 'nope'], ctx);
  expect(code).toBe(1);
  expect(out()).toBe('');
  expect(err()).toBe('');
});

it('emits one result per line for multiple existing operands', async () => {
  // Failure mode: joining results without newlines or dropping operands.
  seed({ '/a': 'x', '/b': 'y' });
  const { ctx, out } = makeCtx({ cwd: '/' });
  const code = await realpath(['a', 'b'], ctx);
  expect(code).toBe(0);
  expect(out()).toBe('/a\n/b\n');
});

it('continues processing remaining operands after one missing path, still exits 1', async () => {
  // Failure mode: aborting the whole run on the first missing operand.
  seed({ '/a': 'x' });
  const { ctx, out, err } = makeCtx({ cwd: '/' });
  const code = await realpath(['nope', 'a'], ctx);
  expect(code).toBe(1);
  expect(out()).toBe('/a\n');
  expect(err()).toBe('realpath: nope: No such file or directory\n');
});

it('exits 1 with a usage error and no stdout when no operand is given', async () => {
  // Failure mode: treating zero operands as success (GNU requires at least one).
  seed({});
  const { ctx, out, err } = makeCtx();
  const code = await realpath([], ctx);
  expect(code).toBe(1);
  expect(out()).toBe('');
  expect(err()).not.toBe('');
});

it('throws NotImplementedError for --relative-to (no symlink-free relative-path mode)', async () => {
  // Failure mode: silently ignoring --relative-to instead of throwing.
  seed({ '/a': 'x' });
  const { ctx } = makeCtx({ cwd: '/' });
  await expect(realpath(['--relative-to=/', 'a'], ctx)).rejects.toBeInstanceOf(NotImplementedError);
});

it('throws NotImplementedError for -s (no symlink mode to strip)', async () => {
  // Failure mode: silently accepting -s when VFS has no symlinks to strip.
  seed({ '/a': 'x' });
  const { ctx } = makeCtx({ cwd: '/' });
  await expect(realpath(['-s', 'a'], ctx)).rejects.toBeInstanceOf(NotImplementedError);
});
