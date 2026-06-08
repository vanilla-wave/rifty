/**
 * Tests for the `seq` builtin. Each case pins a GNU-faithful contract from the
 * spec (verified against GNU coreutils `seq`). No VFS read — pure arithmetic.
 */

import { NotImplementedError } from '@riftydev/io';
import { describe, expect, it } from 'vitest';
import { seq } from '../src/commands/seq.ts';
import { makeCtx } from './_ctx.ts';

describe('seq', () => {
  it('one operand is LAST with FIRST=1: seq 3 => 1\\n2\\n3\\n', async () => {
    const { ctx, out, err } = makeCtx();
    const code = await seq(['3'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('1\n2\n3\n');
    expect(err()).toBe('');
  });

  it('FIRST INCR LAST stepping: seq 2 2 8 => 2,4,6,8 one per line', async () => {
    const { ctx, out } = makeCtx();
    const code = await seq(['2', '2', '8'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('2\n4\n6\n8\n');
  });

  it('descending range without a negative increment is empty (GNU): seq 5 1', async () => {
    // Bug guard: a naive `for (i=first; i<=last)` would also be empty, but a
    // `<=`/`>=` direction-by-sign would wrongly count down. Must stay empty.
    const { ctx, out, err } = makeCtx();
    const code = await seq(['5', '1'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('');
    expect(err()).toBe('');
  });

  it('-s SEP joins values with no trailing SEP but a trailing newline', async () => {
    // Guards the off-by-one: BSD seq appends a trailing SEP; GNU does not.
    const { ctx, out } = makeCtx();
    const code = await seq(['-s', ',', '1', '3'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('1,2,3\n');
  });

  it('-w zero-pads every value to the widest: seq -w 8 10 => 08,09,10', async () => {
    const { ctx, out } = makeCtx();
    const code = await seq(['-w', '8', '10'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('08\n09\n10\n');
  });

  it('float increment fixes precision from FIRST/INCR: seq 1 0.5 2 => 1.0,1.5,2.0', async () => {
    // Catches integer-only output: GNU prints every value with the max decimal
    // places of FIRST and INCR even without -w.
    const { ctx, out } = makeCtx();
    const code = await seq(['1', '0.5', '2'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('1.0\n1.5\n2.0\n');
  });

  it('-w width accounts for the decimal part: seq -w 1 0.5 10.5 pads integer part', async () => {
    // Width must be the widest *formatted* value (incl. decimals), zero-padding
    // the integer part only: '01.0' .. '10.5'.
    const { ctx, out } = makeCtx();
    const code = await seq(['-w', '1', '0.5', '10.5'], ctx);
    expect(code).toBe(0);
    const lines = out().trimEnd().split('\n');
    expect(lines[0]).toBe('01.0');
    expect(lines.at(-1)).toBe('10.5');
  });

  it('combined short flags -ws, behave as -w -s ,', async () => {
    // Guards flag bundling: -s takes the rest of the cluster as its argument.
    const { ctx, out } = makeCtx();
    const code = await seq(['-ws,', '8', '10'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('08,09,10\n');
  });

  it('exits 1 with a stderr error and no stdout on a non-numeric operand', async () => {
    const { ctx, out, err } = makeCtx();
    const code = await seq(['bad'], ctx);
    expect(code).toBe(1);
    expect(out()).toBe('');
    expect(err()).not.toBe('');
  });

  it('exits 1 with no stdout when no operand is given', async () => {
    const { ctx, out, err } = makeCtx();
    const code = await seq([], ctx);
    expect(code).toBe(1);
    expect(out()).toBe('');
    expect(err()).not.toBe('');
  });

  it('exits 1 on a zero increment (would never terminate)', async () => {
    const { ctx, out, err } = makeCtx();
    const code = await seq(['1', '0', '3'], ctx);
    expect(code).toBe(1);
    expect(out()).toBe('');
    expect(err()).not.toBe('');
  });

  it('throws NotImplementedError for the unimplemented -f FORMAT flag', async () => {
    const { ctx } = makeCtx();
    await expect(seq(['-f', '%g', '1', '3'], ctx)).rejects.toBeInstanceOf(NotImplementedError);
  });
});
