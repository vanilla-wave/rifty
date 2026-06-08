/**
 * Tests for the `mkdir` builtin. Each case pins a failure mode the spec fixed:
 * -p / --parents recursive creation, the loud throw for a bundled unknown flag
 * (so -pv never becomes a dir literally named '-pv'), missing-operand, and the
 * EEXIST refusal on an existing dir without -p (vs. the -p no-op). Backed by an
 * in-memory mirror so mkdirSync exercises its real EEXIST/ENOTDIR paths.
 */

import { NotImplementedError } from '@riftydev/io';
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdir } from '../src/commands/mkdir.ts';
import { makeCtx } from './_ctx.ts';

/** Install a fresh in-memory mirror; return it so tests can read/seed directly. */
function seed(): MemoryFsSync {
  const fs = new MemoryFsSync();
  setSyncMirror(fs);
  return fs;
}

beforeEach(() => resetSyncMirror());
afterEach(() => resetSyncMirror());

it('mkdir -p a/b/c creates nested dirs, exit 0', async () => {
  // Failure mode: -p not mapped to recursive, so deep paths fail on ENOENT.
  const fs = seed();
  const { ctx, err } = makeCtx();
  const code = await mkdir(['-p', '/a/b/c'], ctx);
  expect(code).toBe(0);
  expect(fs.statSync('/a/b/c').isDirectory).toBe(true);
  expect(err()).toBe('');
});

it('mkdir --parents x/y is an alias for -p', async () => {
  // Failure mode: long-form --parents not honored.
  const fs = seed();
  const { ctx, err } = makeCtx();
  const code = await mkdir(['--parents', '/x/y'], ctx);
  expect(code).toBe(0);
  expect(fs.statSync('/x/y').isDirectory).toBe(true);
  expect(err()).toBe('');
});

it('mkdir -pv throws NotImplementedError and creates no -pv dir', async () => {
  // Failure mode: unknown bundled flag silently ignored, or '-pv' made a dir.
  const fs = seed();
  const { ctx } = makeCtx();
  await expect(mkdir(['-pv', '/d'], ctx)).rejects.toBeInstanceOf(NotImplementedError);
  expect(fs.existsSync('/-pv')).toBe(false);
});

it('mkdir with no operand: stderr missing-operand, exit 1', async () => {
  // Failure mode: a 0-operand call silently succeeding.
  seed();
  const { ctx, err } = makeCtx();
  const code = await mkdir([], ctx);
  expect(code).toBe(1);
  expect(err()).toBe('mkdir: missing operand\n');
});

it('mkdir of an existing dir without -p: stderr File exists, exit 1', async () => {
  // Failure mode: swallowing EEXIST when -p is absent.
  const fs = seed();
  fs.mkdirSync('/d', {});
  const { ctx, err } = makeCtx();
  const code = await mkdir(['/d'], ctx);
  expect(code).toBe(1);
  expect(err()).toBe("mkdir: cannot create directory '/d': File exists\n");
});

it('mkdir -p of an existing dir: exit 0, no output', async () => {
  // Failure mode: -p failing to make an existing dir a silent no-op.
  const fs = seed();
  fs.mkdirSync('/d', {});
  const { ctx, err } = makeCtx();
  const code = await mkdir(['-p', '/d'], ctx);
  expect(code).toBe(0);
  expect(err()).toBe('');
});
