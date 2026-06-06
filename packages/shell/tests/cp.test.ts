/**
 * Tests for the `cp` builtin. Each case pins a specific failure mode from the
 * spec: byte-faithful copy, dir-without-`-r` refusal, recursive deep copy,
 * default overwrite, `-n` no-clobber, multi-into-dir, and the loud throw for an
 * unimplemented flag. Backed by an in-memory mirror so the VFS copy primitives
 * exercise their real ENOENT/EISDIR paths.
 */

import { NotImplementedError } from '@riftydev/io';
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { cp } from '../src/commands/cp.ts';
import { makeCtx } from './_ctx.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Install a fresh in-memory mirror; return it so tests can read/seed directly. */
function seed(files: Record<string, string>): MemoryFsSync {
  const fs = new MemoryFsSync();
  for (const [path, content] of Object.entries(files)) {
    const dir = path.slice(0, path.lastIndexOf('/')) || '/';
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path, enc.encode(content));
  }
  setSyncMirror(fs);
  return fs;
}

function read(fs: MemoryFsSync, path: string): string {
  return dec.decode(fs.readFileBytesSync(path));
}

beforeEach(() => resetSyncMirror());
afterEach(() => resetSyncMirror());

it('cp SRC DST copies bytes verbatim, exit 0, no output, source kept', async () => {
  // Failure mode: not writing dst, mangling bytes, or removing src (that's mv).
  const fs = seed({ '/a.txt': 'hello\n' });
  const { ctx, out, err } = makeCtx();
  const code = await cp(['/a.txt', '/b.txt'], ctx);
  expect(code).toBe(0);
  expect(read(fs, '/b.txt')).toBe('hello\n');
  expect(fs.existsSync('/a.txt')).toBe(true);
  expect(out()).toBe('');
  expect(err()).toBe('');
});

it('cp does NOT preserve mtime (a copy is a new file, dst mtime = now)', async () => {
  // Failure mode: copying the source mtime (would need -p, which we throw on).
  const fs = seed({ '/a.txt': 'x' });
  fs.utimes('/a.txt', 1000, 1000); // ancient source mtime
  const { ctx } = makeCtx();
  await cp(['/a.txt', '/b.txt'], ctx);
  // dst is freshly written => mtime stamped now, NOT the source's 1000ms.
  expect(fs.statSync('/b.txt').mtime).toBeGreaterThan(1000);
});

it('cp of a DIR without -r refuses: stderr omitting-directory, exit 1', async () => {
  // Failure mode: silently recursing without -r, or a non-1 exit.
  const fs = seed({ '/d/inner.txt': 'k' });
  const { ctx, out, err } = makeCtx();
  const code = await cp(['/d', '/copy'], ctx);
  expect(code).toBe(1);
  expect(err()).toBe("cp: -r not specified; omitting directory '/d'\n");
  expect(out()).toBe('');
  expect(fs.existsSync('/copy')).toBe(false); // nothing created
});

it('cp -r deep-copies a directory tree', async () => {
  // Failure mode: shallow copy (missing nested files) or failing on a dir src.
  const fs = seed({ '/d/a.txt': 'A', '/d/sub/b.txt': 'B' });
  const { ctx, err } = makeCtx();
  const code = await cp(['-r', '/d', '/copy'], ctx);
  expect(code).toBe(0);
  expect(read(fs, '/copy/a.txt')).toBe('A');
  expect(read(fs, '/copy/sub/b.txt')).toBe('B');
  expect(err()).toBe('');
});

it('-R is an alias for -r (deep copy)', async () => {
  // Failure mode: only honoring -r, throwing/ignoring the equally-valid -R.
  const fs = seed({ '/d/a.txt': 'A' });
  const { ctx } = makeCtx();
  const code = await cp(['-R', '/d', '/copy'], ctx);
  expect(code).toBe(0);
  expect(read(fs, '/copy/a.txt')).toBe('A');
});

it('cp overwrites an existing dst by default', async () => {
  // Failure mode: refusing to clobber by default (that would be -n behavior).
  const fs = seed({ '/a.txt': 'new', '/b.txt': 'old' });
  const { ctx } = makeCtx();
  const code = await cp(['/a.txt', '/b.txt'], ctx);
  expect(code).toBe(0);
  expect(read(fs, '/b.txt')).toBe('new');
});

it('-n refuses to overwrite an existing dst, exit 0, dst untouched', async () => {
  // Failure mode: clobbering despite -n, or treating the skip as an error.
  const fs = seed({ '/a.txt': 'new', '/b.txt': 'old' });
  const { ctx, err } = makeCtx();
  const code = await cp(['-n', '/a.txt', '/b.txt'], ctx);
  expect(code).toBe(0);
  expect(read(fs, '/b.txt')).toBe('old'); // preserved
  expect(err()).toBe('');
});

it('cp SRC... DIR copies each source into DIR/basename(src)', async () => {
  // Failure mode: collapsing multiple sources onto one dst path / wrong names.
  const fs = seed({ '/a.txt': 'A', '/b.txt': 'B', '/dst/.keep': '' });
  const { ctx, err } = makeCtx();
  const code = await cp(['/a.txt', '/b.txt', '/dst'], ctx);
  expect(code).toBe(0);
  expect(read(fs, '/dst/a.txt')).toBe('A');
  expect(read(fs, '/dst/b.txt')).toBe('B');
  expect(err()).toBe('');
});

it('-v prints each copy as "SRC -> DST" to stdout', async () => {
  // Failure mode: verbose line missing, malformed, or sent to stderr.
  seed({ '/a.txt': 'A' });
  const { ctx, out, err } = makeCtx();
  const code = await cp(['-v', '/a.txt', '/b.txt'], ctx);
  expect(code).toBe(0);
  expect(out()).toBe("'/a.txt' -> '/b.txt'\n");
  expect(err()).toBe('');
});

it('missing source: stderr "cp: cannot stat ...", exit 1', async () => {
  // Failure mode: swallowing ENOENT or a non-1 exit on a missing source.
  seed({});
  const { ctx, out, err } = makeCtx();
  const code = await cp(['/nope.txt', '/b.txt'], ctx);
  expect(code).toBe(1);
  expect(out()).toBe('');
  expect(err()).toBe("cp: cannot stat '/nope.txt': No such file or directory\n");
});

it('too few operands: usage error, exit 1', async () => {
  // Failure mode: a 0/1-operand call silently succeeding (corrupts && chains).
  seed({});
  const { ctx, err } = makeCtx();
  const code = await cp(['/only.txt'], ctx);
  expect(code).toBe(1);
  expect(err()).toBe('cp: missing destination file operand\n');
});

it('-p (and other unimplemented flags) throws NotImplementedError', async () => {
  // Failure mode: silently ignoring -p (would imply mtime preservation we lack).
  seed({ '/a.txt': 'x' });
  const { ctx } = makeCtx();
  await expect(cp(['-p', '/a.txt', '/b.txt'], ctx)).rejects.toBeInstanceOf(NotImplementedError);
});
