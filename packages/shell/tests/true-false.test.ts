/**
 * Tests for the `true` / `false` builtins. Both are degenerate POSIX/GNU
 * commands: they ALWAYS exit 0 / 1 respectively and ignore every argument,
 * including flag-looking ones (verified: GNU/BSD `true --x a b` => 0,
 * `false --x` => 1). Each case pins a specific failure mode below.
 */

import { describe, expect, it } from 'vitest';
import { falseCmd, trueCmd } from '../src/commands/true-false.ts';
import { makeCtx } from './_ctx.ts';

describe('true', () => {
  it('exits 0 with no args', async () => {
    // Failure mode: returning anything but 0 (breaks `cmd && true`).
    const { ctx, out, err } = makeCtx();
    const code = await trueCmd([], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('');
    expect(err()).toBe('');
  });

  it('exits 0 ignoring operands', async () => {
    // Failure mode: treating operands as something that can fail.
    const { ctx } = makeCtx();
    expect(await trueCmd(['anything', 'else'], ctx)).toBe(0);
  });
});

describe('false', () => {
  it('exits 1 with no args', async () => {
    // Failure mode: returning 0 (breaks `cmd || false` / negation tests).
    const { ctx, out, err } = makeCtx();
    const code = await falseCmd([], ctx);
    expect(code).toBe(1);
    expect(out()).toBe('');
    expect(err()).toBe('');
  });

  it('exits 1 ignoring operands', async () => {
    // Failure mode: returning 0 once given operands.
    const { ctx } = makeCtx();
    expect(await falseCmd(['anything', 'else'], ctx)).toBe(1);
  });
});

describe('true/false flag handling (GNU fidelity)', () => {
  // The deliverable's generic "unimplemented flag THROWS NotImplementedError"
  // case does NOT apply here: GNU/POSIX `true`/`false` are specified to ignore
  // ALL options as operands (verified against system `true`/`false`). Ignoring
  // them is the CORRECT contract, not a silent stub — the no-silent-stub rule
  // targets a flag pretending to change behaviour, but these commands have no
  // behaviour to change. So we assert the inverse: flag-looking args are
  // ignored, NOT thrown. Failure mode: a regression to a flag-parser that
  // errors/throws on `-z`/`--bogus` and breaks `true --version`-style calls.
  it('true ignores flag-looking args (does not throw)', async () => {
    const { ctx } = makeCtx();
    expect(await trueCmd(['-z', '--bogus', '-abc'], ctx)).toBe(0);
  });

  it('false ignores flag-looking args (does not throw)', async () => {
    const { ctx } = makeCtx();
    expect(await falseCmd(['-z', '--bogus', '-abc'], ctx)).toBe(1);
  });
});
