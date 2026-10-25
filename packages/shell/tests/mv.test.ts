import { NotImplementedError } from '@riftydev/io';
import { VfsError } from '@riftydev/vfs';
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { mv } from '../src/commands/mv.ts';
import { makeCtx } from './_ctx.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

let fs: MemoryFsSync;

/** Install a fresh in-memory mirror seeded with `files` (dirs auto-created). */
function seed(files: Record<string, string>): void {
  fs = new MemoryFsSync();
  for (const [path, content] of Object.entries(files)) {
    const dir = path.slice(0, path.lastIndexOf('/')) || '/';
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path, enc.encode(content));
  }
  setSyncMirror(fs);
}

beforeEach(() => resetSyncMirror());
afterEach(() => resetSyncMirror());

it('mv a b: moves the file AND preserves mtime (the ADR-0090 win)', async () => {
  seed({ '/a': 'alpha' });
  fs.utimes('/a', 123_000, 123_000);
  const pre = fs.statSync('/a').mtime;
  const { ctx, out, err } = makeCtx();
  const code = await mv(['/a', '/b'], ctx);
  expect(code).toBe(0);
  expect(fs.existsSync('/a')).toBe(false);
  expect(dec.decode(fs.readFileBytesSync('/b'))).toBe('alpha');
  // rename != copy+rm: mtime must NOT be restamped to now.
  expect(fs.statSync('/b').mtime).toBe(pre);
  expect(out()).toBe('');
  expect(err()).toBe('');
});

it('cross-dir move relocates the entry between parents', async () => {
  seed({ '/src/x': 'data' });
  fs.mkdirSync('/dst', { recursive: true });
  const { ctx, err } = makeCtx();
  const code = await mv(['/src/x', '/dst/x'], ctx);
  expect(code).toBe(0);
  expect(fs.existsSync('/src/x')).toBe(false);
  expect(dec.decode(fs.readFileBytesSync('/dst/x'))).toBe('data');
  expect(err()).toBe('');
});

it('resolves relative SRC/DST against ctx.cwd', async () => {
  seed({ '/work/a': 'rel' });
  const { ctx, err } = makeCtx({ cwd: '/work' });
  const code = await mv(['a', 'b'], ctx);
  expect(code).toBe(0);
  expect(fs.existsSync('/work/a')).toBe(false);
  expect(dec.decode(fs.readFileBytesSync('/work/b'))).toBe('rel');
  expect(err()).toBe('');
});

it('mv DIR EXISTINGDIR lands the dir at DST/basename (GNU into-dir), dst contents kept', async () => {
  seed({ '/srcdir/a': 'x', '/dst/occupied': 'y' });
  const { ctx, out, err } = makeCtx();
  const code = await mv(['/srcdir', '/dst'], ctx);
  expect(code).toBe(0);
  expect(fs.existsSync('/srcdir')).toBe(false);
  expect(dec.decode(fs.readFileBytesSync('/dst/srcdir/a'))).toBe('x');
  expect(fs.existsSync('/dst/occupied')).toBe(true); // non-empty dst preserved
  expect(out()).toBe('');
  expect(err()).toBe('');
});

it('mv DIR EXISTINGDIR where DST/basename already exists non-empty surfaces ENOTEMPTY, exit 1', async () => {
  // GNU: into-dir target /dst/srcdir exists and is non-empty -> cannot overwrite.
  seed({ '/srcdir/a': 'x', '/dst/srcdir/keep': 'y' });
  const { ctx, out, err } = makeCtx();
  const code = await mv(['/srcdir', '/dst'], ctx);
  expect(code).toBe(1);
  expect(out()).toBe('');
  expect(err()).toMatch(/^mv: cannot move .*Directory not empty/);
  expect(fs.existsSync('/srcdir/a')).toBe(true); // source untouched
});

it('multi-source into a DIR: each SRC moved to DIR/basename', async () => {
  seed({ '/a': 'A', '/b': 'B' });
  fs.mkdirSync('/dir', { recursive: true });
  const { ctx, err } = makeCtx();
  const code = await mv(['/a', '/b', '/dir'], ctx);
  expect(code).toBe(0);
  expect(fs.existsSync('/a')).toBe(false);
  expect(fs.existsSync('/b')).toBe(false);
  expect(dec.decode(fs.readFileBytesSync('/dir/a'))).toBe('A');
  expect(dec.decode(fs.readFileBytesSync('/dir/b'))).toBe('B');
  expect(err()).toBe('');
});

it('single-source mv FILE EXISTINGDIR lands at DIR/basename (GNU), src gone', async () => {
  seed({ '/a.txt': 'content' });
  fs.mkdirSync('/d', { recursive: true });
  const { ctx, out, err } = makeCtx();
  const code = await mv(['/a.txt', '/d'], ctx);
  expect(code).toBe(0);
  expect(fs.existsSync('/a.txt')).toBe(false);
  expect(dec.decode(fs.readFileBytesSync('/d/a.txt'))).toBe('content');
  expect(out()).toBe('');
  expect(err()).toBe('');
});

it('multi-source mv /a /b /d into existing dir: both land at /d/basename', async () => {
  seed({ '/a': 'A', '/b': 'B' });
  fs.mkdirSync('/d', { recursive: true });
  const { ctx, err } = makeCtx();
  const code = await mv(['/a', '/b', '/d'], ctx);
  expect(code).toBe(0);
  expect(fs.existsSync('/a')).toBe(false);
  expect(fs.existsSync('/b')).toBe(false);
  expect(dec.decode(fs.readFileBytesSync('/d/a'))).toBe('A');
  expect(dec.decode(fs.readFileBytesSync('/d/b'))).toBe('B');
  expect(err()).toBe('');
});

it('regression: 2-operand mv /a /b where /b is NOT a dir does a plain rename to /b', async () => {
  seed({ '/a': 'X' });
  const { ctx, out, err } = makeCtx();
  const code = await mv(['/a', '/b'], ctx);
  expect(code).toBe(0);
  expect(fs.existsSync('/a')).toBe(false);
  expect(dec.decode(fs.readFileBytesSync('/b'))).toBe('X');
  expect(out()).toBe('');
  expect(err()).toBe('');
});

it('mv a a: src===dst no-op, file preserved, exit 0', async () => {
  seed({ '/a': 'keep' });
  const { ctx, out, err } = makeCtx();
  const code = await mv(['/a', '/a'], ctx);
  expect(code).toBe(0);
  expect(dec.decode(fs.readFileBytesSync('/a'))).toBe('keep');
  expect(out()).toBe('');
  expect(err()).toBe('');
});

it('-v prints "renamed SRC -> DST" to stdout per move', async () => {
  seed({ '/a': 'A' });
  const { ctx, out, err } = makeCtx();
  const code = await mv(['-v', '/a', '/b'], ctx);
  expect(code).toBe(0);
  expect(out()).toBe("renamed '/a' -> '/b'\n");
  expect(err()).toBe('');
});

it('-n (no-clobber) skips an existing DST without error, exit 0, source kept', async () => {
  seed({ '/a': 'new', '/b': 'old' });
  const { ctx, out, err } = makeCtx();
  const code = await mv(['-n', '/a', '/b'], ctx);
  expect(code).toBe(0);
  // DST left as-is; SRC not consumed.
  expect(dec.decode(fs.readFileBytesSync('/b'))).toBe('old');
  expect(fs.existsSync('/a')).toBe(true);
  expect(out()).toBe('');
  expect(err()).toBe('');
});

it('missing SRC surfaces a GNU stat error, exit 1', async () => {
  seed({});
  const { ctx, out, err } = makeCtx();
  const code = await mv(['/nope', '/dst'], ctx);
  expect(code).toBe(1);
  expect(out()).toBe('');
  expect(err()).toMatch(/^mv: cannot stat '\/nope': No such file or directory/);
});

it('too few operands: usage error to stderr, exit 1', async () => {
  seed({ '/a': 'x' });
  const { ctx, out, err } = makeCtx();
  const code = await mv(['/a'], ctx);
  expect(code).toBe(1);
  expect(out()).toBe('');
  expect(err()).toMatch(/^mv: missing/);
});

it('-f (and -i/-u/-b) throws NotImplementedError', async () => {
  seed({ '/a': 'x' });
  const { ctx } = makeCtx();
  await expect(mv(['-f', '/a', '/b'], ctx)).rejects.toBeInstanceOf(NotImplementedError);
  await expect(mv(['-i', '/a', '/b'], ctx)).rejects.toBeInstanceOf(NotImplementedError);
  await expect(mv(['-u', '/a', '/b'], ctx)).rejects.toBeInstanceOf(NotImplementedError);
  await expect(mv(['-b', '/a', '/b'], ctx)).rejects.toBeInstanceOf(NotImplementedError);
});

/** Two mounts (`/tmp` and the rest), as the ADR-0531 guest namespace: rename across → EXDEV. */
class TwoMountFs extends MemoryFsSync {
  override renameSync(src: string, dst: string): void {
    const tmp = (path: string): boolean => path === '/tmp' || path.startsWith('/tmp/');
    if (tmp(src) !== tmp(dst)) throw new VfsError('EXDEV', src);
    super.renameSync(src, dst);
  }
}

function seedTwoMounts(files: Record<string, string>): void {
  fs = new TwoMountFs();
  fs.mkdirSync('/tmp', { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    const dir = path.slice(0, path.lastIndexOf('/')) || '/';
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path, enc.encode(content));
  }
  setSyncMirror(fs);
}

it('mv across mounts keeps file and directory-tree mtimes (GNU copies attributes)', async () => {
  seedTwoMounts({ '/tmp/f': 'file', '/tmp/d/a': 'alpha', '/tmp/d/sub/b': 'beta' });
  fs.utimes('/tmp/f', 111_000, 111_000);
  fs.utimes('/tmp/d/a', 222_000, 222_000);
  fs.utimes('/tmp/d/sub/b', 333_000, 333_000);
  fs.utimes('/tmp/d/sub', 444_000, 444_000);
  fs.utimes('/tmp/d', 555_000, 555_000);
  const { ctx, err } = makeCtx();
  expect(await mv(['/tmp/f', '/proj-f'], ctx)).toBe(0);
  expect(await mv(['/tmp/d', '/proj-d'], ctx)).toBe(0);
  expect(err()).toBe('');
  expect(fs.existsSync('/tmp/f') || fs.existsSync('/tmp/d')).toBe(false);
  expect(dec.decode(fs.readFileBytesSync('/proj-d/sub/b'))).toBe('beta');
  expect(
    ['/proj-f', '/proj-d/a', '/proj-d/sub/b', '/proj-d/sub', '/proj-d'].map(
      (path) => fs.statSync(path).mtime,
    ),
  ).toEqual([111_000, 222_000, 333_000, 444_000, 555_000]);
});

it('mv of a directory across mounts onto a non-empty directory fails and keeps both', async () => {
  seedTwoMounts({ '/tmp/d/a': 'new', '/proj/d/old': 'old' });
  const { ctx, err } = makeCtx();
  expect(await mv(['/tmp/d', '/proj'], ctx)).toBe(1);
  expect(err()).toBe(
    "mv: inter-device move failed: '/tmp/d' to '/proj/d'; unable to remove target: Directory not empty\n",
  );
  expect(dec.decode(fs.readFileBytesSync('/tmp/d/a'))).toBe('new');
  expect(fs.existsSync('/proj/d/a')).toBe(false);
  expect(dec.decode(fs.readFileBytesSync('/proj/d/old'))).toBe('old');
});

it('mv of a directory across mounts replaces an empty directory, as rename does', async () => {
  seedTwoMounts({ '/tmp/d/a': 'new' });
  fs.mkdirSync('/proj/d', { recursive: true });
  const { ctx, err } = makeCtx();
  expect(await mv(['/tmp/d', '/proj'], ctx)).toBe(0);
  expect(err()).toBe('');
  expect(dec.decode(fs.readFileBytesSync('/proj/d/a'))).toBe('new');
  expect(fs.existsSync('/tmp/d')).toBe(false);
});
