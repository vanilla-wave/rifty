/**
 * Tests for the `rm` builtin. Each case pins a failure mode the spec fixed:
 * bundled flags in either order (-fr / -rf), the loud throw for an unknown
 * flag, missing-operand handling with and without -f, the dir-without-r refusal,
 * ENOENT with/without -f, and continue-through-operands semantics. Backed by an
 * in-memory mirror so rmSync exercises real ENOENT/EISDIR paths.
 */

import { NotImplementedError } from '@riftydev/io';
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { rm } from '../src/commands/rm.ts';
import { makeCtx } from './_ctx.ts';

const enc = new TextEncoder();

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

beforeEach(() => resetSyncMirror());
afterEach(() => resetSyncMirror());

it('rm -fr removes a non-empty dir, exit 0 (bundled flags, f before r)', async () => {
  // Failure mode: old parser only matched literal -rf, so -fr broke.
  const fs = seed({ '/d/a.txt': 'A', '/d/sub/b.txt': 'B' });
  const { ctx, err } = makeCtx();
  const code = await rm(['-fr', '/d'], ctx);
  expect(code).toBe(0);
  expect(fs.existsSync('/d')).toBe(false);
  expect(err()).toBe('');
});

it('rm -rf removes a non-empty dir, exit 0 (bundled flags, r before f)', async () => {
  const fs = seed({ '/d/a.txt': 'A', '/d/sub/b.txt': 'B' });
  const { ctx, err } = makeCtx();
  const code = await rm(['-rf', '/d'], ctx);
  expect(code).toBe(0);
  expect(fs.existsSync('/d')).toBe(false);
  expect(err()).toBe('');
});

it('rm -x throws NotImplementedError for an unknown bundled flag', async () => {
  // Failure mode: silently treating -x as a no-op or as a path operand.
  seed({ '/f': 'x' });
  const { ctx } = makeCtx();
  await expect(rm(['-x', '/f'], ctx)).rejects.toBeInstanceOf(NotImplementedError);
});

it('rm with no operand: stderr missing-operand, exit 1', async () => {
  // Failure mode: a 0-operand call silently succeeding (corrupts && chains).
  seed({});
  const { ctx, err } = makeCtx();
  const code = await rm([], ctx);
  expect(code).toBe(1);
  expect(err()).toBe('rm: missing operand\n');
});

it('rm -f with no operand: silent no-op, exit 0', async () => {
  // Failure mode: GNU rm -f with no operand must NOT error.
  seed({});
  const { ctx, err } = makeCtx();
  const code = await rm(['-f'], ctx);
  expect(code).toBe(0);
  expect(err()).toBe('');
});

it('rm DIR without -r refuses: stderr Is a directory, exit 1, dir survives', async () => {
  // Failure mode: removing a directory without -r (data loss).
  const fs = seed({ '/d/inner.txt': 'k' });
  const { ctx, err } = makeCtx();
  const code = await rm(['/d'], ctx);
  expect(code).toBe(1);
  expect(err()).toBe("rm: cannot remove '/d': Is a directory\n");
  expect(fs.existsSync('/d')).toBe(true);
});

it('rm missing file without -f: stderr No such file, exit 1', async () => {
  // Failure mode: swallowing ENOENT when -f is absent.
  seed({});
  const { ctx, err } = makeCtx();
  const code = await rm(['/nope'], ctx);
  expect(code).toBe(1);
  expect(err()).toBe("rm: cannot remove '/nope': No such file or directory\n");
});

it('rm -f missing file: exit 0, no output', async () => {
  // Failure mode: -f failing to suppress a missing-operand error.
  seed({});
  const { ctx, err } = makeCtx();
  const code = await rm(['-f', '/nope'], ctx);
  expect(code).toBe(0);
  expect(err()).toBe('');
});

it('rm continues through operands: removes the present one, exit 1 overall', async () => {
  // Failure mode: bailing on the first missing operand, leaving the rest.
  const fs = seed({ '/present': 'p' });
  const { ctx, err } = makeCtx();
  const code = await rm(['/missing', '/present'], ctx);
  expect(code).toBe(1);
  expect(fs.existsSync('/present')).toBe(false); // still removed
  expect(err()).toBe("rm: cannot remove '/missing': No such file or directory\n");
});
