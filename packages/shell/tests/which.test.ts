/**
 * Tests for the `which` builtin factory. Each case pins a specific failure mode:
 * known name echoed (our builtins have no PATH, so the honest location is the
 * name), unknown name silent (GNU which prints nothing on a miss), the
 * all-or-nothing exit (0 iff every name resolved, 1 if any missed), the
 * no-operand usage error (exit 2), and the loud throw for `-a` we don't do.
 * A typed resolver fixture stands in for Shell's live resolver — no real Shell
 * is constructed.
 */

import { NotImplementedError } from '@riftydev/io';
import { expect, it } from 'vitest';
import type { CommandResolution } from '../src/command-resolver.ts';
import { which } from '../src/commands/which.ts';
import { makeCtx } from './_ctx.ts';

/** Typed resolver fixture: only `echo` and `cat` are registered. */
const resolve = (name: string): CommandResolution =>
  name === 'echo' || name === 'cat'
    ? { kind: 'registered', command: async () => 0 }
    : { kind: 'miss', reason: 'bare' };

it('known name: writes NAME + newline to stdout, exit 0', async () => {
  // Failure mode: printing a fake "/usr/bin" path, or omitting the newline.
  const { ctx, out, err } = makeCtx();
  const code = await which(resolve)(['echo'], ctx);
  expect(code).toBe(0);
  expect(out()).toBe('echo\n');
  expect(err()).toBe('');
});

it('unknown name: nothing to stdout, exit 1 (GNU which is silent on a miss)', async () => {
  // Failure mode: echoing the missed name anyway, or exiting 0 on a miss.
  const { ctx, out } = makeCtx();
  const code = await which(resolve)(['nope'], ctx);
  expect(code).toBe(1);
  expect(out()).toBe('');
});

it('mixed: known echoed, unknown silent, exit 1 (any miss => 1)', async () => {
  // Failure mode: exit 0 because at least one resolved (must be all-or-nothing).
  const { ctx, out } = makeCtx();
  const code = await which(resolve)(['echo', 'nope'], ctx);
  expect(code).toBe(1);
  expect(out()).toBe('echo\n'); // only the resolved name printed
});

it('all known: each echoed in order, exit 0', async () => {
  // Failure mode: dropping a name, reordering, or a stray non-zero exit.
  const { ctx, out } = makeCtx();
  const code = await which(resolve)(['echo', 'cat'], ctx);
  expect(code).toBe(0);
  expect(out()).toBe('echo\ncat\n');
});

it('no name operands: usage error, exit 2 (distinct from a 1 miss)', async () => {
  // Failure mode: exit 0/1 on no args; 2 is the load-bearing usage code.
  const { ctx, out } = makeCtx();
  const code = await which(resolve)([], ctx);
  expect(code).toBe(2);
  expect(out()).toBe('');
});

it('-a throws NotImplementedError (we have no PATH to enumerate)', async () => {
  // Failure mode: silently treating -a as a name and "missing" it.
  const { ctx } = makeCtx();
  await expect(which(resolve)(['-a', 'echo'], ctx)).rejects.toBeInstanceOf(NotImplementedError);
});

it('-s throws NotImplementedError (silent-mode flag unimplemented)', async () => {
  const { ctx } = makeCtx();
  await expect(which(resolve)(['-s', 'echo'], ctx)).rejects.toBeInstanceOf(NotImplementedError);
});
