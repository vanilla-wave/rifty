/**
 * Tests for the `touch` builtin. Each case pins a failure mode the spec fixed:
 * multi-operand creation, the loud throw for an unimplemented flag (so -c never
 * becomes a file literally named '-c'), missing-operand, and `--` end-of-options
 * so a leading-dash filename like '-weird' is creatable. Backed by an in-memory
 * mirror so writeFileSync exercises the real VFS write path.
 */

import { NotImplementedError } from '@riftydev/io';
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { touch } from '../src/commands/touch.ts';
import { makeCtx } from './_ctx.ts';

/** Install a fresh in-memory mirror; return it so tests can read/seed directly. */
function seed(): MemoryFsSync {
  const fs = new MemoryFsSync();
  setSyncMirror(fs);
  return fs;
}

beforeEach(() => resetSyncMirror());
afterEach(() => resetSyncMirror());

it('touch a b creates both files, exit 0', async () => {
  // Failure mode: stopping after the first operand or wrong exit on success.
  const fs = seed();
  const { ctx, err } = makeCtx();
  const code = await touch(['/a', '/b'], ctx);
  expect(code).toBe(0);
  expect(fs.existsSync('/a')).toBe(true);
  expect(fs.existsSync('/b')).toBe(true);
  expect(err()).toBe('');
});

it('touch -c throws NotImplementedError and creates no -c file', async () => {
  // Failure mode: flag silently treated as a filename, creating '/-c'.
  const fs = seed();
  const { ctx } = makeCtx();
  await expect(touch(['-c', '/f'], ctx)).rejects.toBeInstanceOf(NotImplementedError);
  expect(fs.existsSync('/-c')).toBe(false);
});

it('touch with no operand: stderr missing-operand, exit 1', async () => {
  // Failure mode: a 0-operand call silently succeeding.
  seed();
  const { ctx, err } = makeCtx();
  const code = await touch([], ctx);
  expect(code).toBe(1);
  expect(err()).toBe('touch: missing operand\n');
});

it('touch -- -weird creates a file literally named -weird', async () => {
  // Failure mode: not honoring -- end-of-options, so a dash-led name is unusable.
  const fs = seed();
  const { ctx, err } = makeCtx();
  const code = await touch(['--', '/-weird'], ctx);
  expect(code).toBe(0);
  expect(fs.existsSync('/-weird')).toBe(true);
  expect(err()).toBe('');
});
