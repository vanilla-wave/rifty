/**
 * Unit tests for the rich `ls` builtin. Each case pins a specific failure mode:
 * byte-order sort, -a/-A/default dotfile policy, -r reversal, -t mtime sort,
 * missing-path exit 1, the loud throw on an unimplemented flag, --color=auto
 * gating on isTTY, and the -l long-format line STRUCTURE (metadata fields are
 * fixed placeholders per ADR-0050 — see ls-fixtures for the byte-faithful set).
 */

import { NotImplementedError } from '@riftydev/io';
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ls } from '../src/commands/ls.ts';
import { makeCtx } from './_ctx.ts';

const enc = new TextEncoder();

/** Install a fresh in-memory mirror; create files/dirs from a spec. */
function seed(spec: { files?: string[]; dirs?: string[] }): MemoryFsSync {
  const fs = new MemoryFsSync();
  for (const d of spec.dirs ?? []) fs.mkdirSync(d, { recursive: true });
  for (const f of spec.files ?? []) {
    const dir = f.slice(0, f.lastIndexOf('/')) || '/';
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(f, enc.encode('x'));
  }
  setSyncMirror(fs);
  return fs;
}

beforeEach(() => resetSyncMirror());
afterEach(() => resetSyncMirror());

it('default: byte-order ascending, one per line on non-TTY, dotfiles hidden', async () => {
  // Failure mode: locale/case-insensitive sort, or leaking dotfiles by default.
  seed({ files: ['/d/banana', '/d/Cherry', '/d/apple.txt', '/d/.hidden'] });
  const { ctx, out, err } = makeCtx({ cwd: '/d' });
  const code = await ls([], ctx);
  expect(code).toBe(0);
  // Byte order: 'C'(0x43) < 'a'(0x61) < 'b'. .hidden absent.
  expect(out()).toBe('Cherry\napple.txt\nbanana\n');
  expect(err()).toBe('');
});

it('-a shows dotfiles INCLUDING . and .., still byte-sorted', async () => {
  // Failure mode: omitting . / .. (that is -A), or wrong sort placement of dots.
  seed({ files: ['/d/apple.txt', '/d/.hidden'] });
  const { ctx, out } = makeCtx({ cwd: '/d' });
  await ls(['-a'], ctx);
  // '.'(0x2e) and '..' sort before '.hidden' (0x2e then 'h'); all before 'a'.
  expect(out()).toBe('.\n..\n.hidden\napple.txt\n');
});

it('-A shows dotfiles but NOT . and ..', async () => {
  // Failure mode: emitting . / .. under -A, or hiding the dotfile too.
  seed({ files: ['/d/apple.txt', '/d/.hidden'] });
  const { ctx, out } = makeCtx({ cwd: '/d' });
  await ls(['-A'], ctx);
  expect(out()).toBe('.hidden\napple.txt\n');
});

it('-r reverses the sort order', async () => {
  // Failure mode: reversing the unsorted list, or not reversing at all.
  seed({ files: ['/d/a', '/d/b', '/d/c'] });
  const { ctx, out } = makeCtx({ cwd: '/d' });
  await ls(['-r'], ctx);
  expect(out()).toBe('c\nb\na\n');
});

it('-t sorts by mtime descending (newest first), -tr reverses to oldest first', async () => {
  // Failure mode: ignoring mtime (falling back to name) or wrong direction.
  const fs = seed({ files: ['/d/old', '/d/mid', '/d/new'] });
  fs.utimes('/d/old', 100, 100);
  fs.utimes('/d/mid', 200, 200);
  fs.utimes('/d/new', 300, 300);
  const { ctx, out } = makeCtx({ cwd: '/d' });
  await ls(['-t'], ctx);
  expect(out()).toBe('new\nmid\nold\n');
  const { ctx: ctx2, out: out2 } = makeCtx({ cwd: '/d' });
  await ls(['-tr'], ctx2);
  expect(out2()).toBe('old\nmid\nnew\n');
});

it('missing path: stderr cannot-access, exit 1, no stdout', async () => {
  // Failure mode: swallowing ENOENT or a non-1 exit (corrupts && / || chains).
  seed({});
  const { ctx, out, err } = makeCtx();
  const code = await ls(['/nope'], ctx);
  expect(code).toBe(1);
  expect(out()).toBe('');
  expect(err()).toBe("ls: cannot access '/nope': No such file or directory\n");
});

it('-R (and any unimplemented flag) throws NotImplementedError', async () => {
  // Failure mode: silently ignoring -R, which would lie about recursion.
  seed({ files: ['/d/a'] });
  const { ctx } = makeCtx({ cwd: '/d' });
  await expect(ls(['-R'], ctx)).rejects.toBeInstanceOf(NotImplementedError);
});

it('--color=auto emits NO SGR when isTTY is false', async () => {
  // Failure mode: writing escape codes into a redirected/piped sink.
  seed({ dirs: ['/d/sub'], files: ['/d/f'] });
  const { ctx, out } = makeCtx({ cwd: '/d', isTTY: false });
  await ls(['--color=auto'], ctx);
  expect(out()).toBe('f\nsub\n'); // plain, no \x1b
  expect(out().includes('\x1b')).toBe(false);
});

it('--color=auto emits SGR for dirs when isTTY is true', async () => {
  // Failure mode: gating color on the wrong signal, or coloring files too.
  seed({ dirs: ['/d/sub'], files: ['/d/f'] });
  const { ctx, out } = makeCtx({ cwd: '/d', isTTY: true, cols: 80 });
  await ls(['--color=auto', '-1'], ctx);
  // dir 'sub' bold-blue, file 'f' plain. -1 keeps one-per-line under TTY.
  expect(out()).toBe('f\n\x1b[1;34msub\x1b[0m\n');
});

it('--color=always emits SGR even when isTTY is false; --color=never never does', async () => {
  // Failure mode: tying always/never to isTTY instead of overriding it.
  seed({ dirs: ['/d/sub'] });
  const { ctx, out } = makeCtx({ cwd: '/d', isTTY: false });
  await ls(['--color=always', '-1'], ctx);
  expect(out()).toBe('\x1b[1;34msub\x1b[0m\n');
  const { ctx: c2, out: o2 } = makeCtx({ cwd: '/d', isTTY: true });
  await ls(['--color=never', '-1'], c2);
  expect(o2()).toBe('sub\n');
});

it('no --color flag: never colors even on a TTY (GNU default)', async () => {
  // Failure mode: defaulting color on under TTY (we are not aliased to --color).
  seed({ dirs: ['/d/sub'] });
  const { ctx, out } = makeCtx({ cwd: '/d', isTTY: true });
  await ls(['-1'], ctx);
  expect(out()).toBe('sub\n');
});

it('-l emits the fixed-placeholder long-format line structure (size right-aligned)', async () => {
  // Failure mode: drifting the column structure, claiming real perms/owner, or
  // not right-aligning the size column GNU-style across the listing.
  const fs = seed({ dirs: ['/d/sub'] });
  fs.writeFileSync('/d/big', enc.encode('0123456789ab')); // size 12 (2 digits)
  fs.writeFileSync('/d/f', enc.encode('hello')); // size 5 (1 digit)
  fs.utimes('/d/big', 0, 1_700_000_000_000);
  fs.utimes('/d/f', 0, 1_700_000_000_000);
  fs.utimes('/d/sub', 0, 1_700_000_000_000);
  const { ctx, out } = makeCtx({ cwd: '/d' });
  const code = await ls(['-l'], ctx);
  expect(code).toBe(0);
  const lines = out().split('\n');
  // sort: 'big' < 'f' < 'sub'. size col width = 2 (max), so '5' → ' 5', '12' → '12'.
  // big: regular file, perms rw-r--r--, nlink 1, owner/group user, real size 12.
  expect(lines[0]).toMatch(/^-rw-r--r-- 1 user user 12 .+ big$/);
  // f: size 5 right-aligned in the 2-wide column ⇒ ' 5' (one leading space).
  expect(lines[1]).toMatch(/^-rw-r--r-- 1 user user {2}5 .+ f$/);
  // sub: directory, perms rwxr-xr-x, size = statSync().size ?? 0 (1-2 digit field).
  expect(lines[2]).toMatch(/^drwxr-xr-x 1 user user [ \d]\d .+ sub$/);
});

it('-l implies one-per-line even on a TTY', async () => {
  // Failure mode: column-packing -l output (must always be one entry per line).
  seed({ files: ['/d/a', '/d/b'] });
  const { ctx, out } = makeCtx({ cwd: '/d', isTTY: true, cols: 80 });
  await ls(['-l'], ctx);
  expect(out().split('\n').filter(Boolean).length).toBe(2);
});

it('multiple PATH args print a "path:" header per dir with blank separators', async () => {
  // Failure mode: collapsing dirs into one list, or missing GNU group headers.
  seed({ files: ['/x/a', '/y/b'] });
  const { ctx, out } = makeCtx();
  const code = await ls(['/x', '/y'], ctx);
  expect(code).toBe(0);
  expect(out()).toBe('/x:\na\n\n/y:\nb\n');
});

it('column-packing engages on a TTY for default listing', async () => {
  // Failure mode: one-per-line under TTY when entries should pack into columns.
  seed({ files: ['/d/aa', '/d/bb', '/d/cc', '/d/dd'] });
  const { ctx, out } = makeCtx({ cwd: '/d', isTTY: true, cols: 80 });
  await ls([], ctx);
  // 4 short names at width 80 pack onto a single row.
  expect(out()).toBe('aa  bb  cc  dd\n');
});

it('-l on an absolute file operand from a non-root cwd does not crash', async () => {
  // Failure mode (pre-fix): entrySize joined cwd + '/etc/hosts' -> '/home//etc/hosts'
  // -> VfsError thrown out of ls. resolve() now handles the absolute operand name.
  seed({ files: ['/etc/hosts'] });
  const { ctx, out, err } = makeCtx({ cwd: '/home' });
  const code = await ls(['-l', '/etc/hosts'], ctx);
  expect(code).toBe(0);
  expect(err()).toBe('');
  expect(out()).toContain('/etc/hosts'); // operand printed by its given name
  expect(out()).toMatch(/ 1 /); // real on-disk size (1 byte) in the -l line
});

it('column width counts visible names, not SGR bytes (colored dir aligns like plain)', async () => {
  // Failure mode (pre-fix): packColumns measured the colorized strings, so the
  // ESC[..m bytes inflated the column width and broke alignment under --color.
  seed({ files: ['/d/aa', '/d/cc'], dirs: ['/d/bb'] }); // bb is a (colored) dir
  const { ctx, out } = makeCtx({ cwd: '/d', isTTY: true, cols: 80 });
  await ls(['--color=always'], ctx);
  const line = out();
  expect(line).toContain('\x1b[1;34mbb\x1b[0m'); // dir colored
  // Gaps between cells are GUTTER(2) spaces measured on the 2-char visible names,
  // NOT widened by the ~9 SGR bytes around 'bb'.
  expect(line).toBe('aa  \x1b[1;34mbb\x1b[0m  cc\n');
});
