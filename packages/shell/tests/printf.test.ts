/**
 * Unit tests for the `printf` builtin. Each case pins one GNU-printf behaviour
 * from the spec; the NotImplementedError case guards the no-silent-stub rule for
 * an unsupported conversion (%b).
 */

import { NotImplementedError } from '@riftydev/io';
import { describe, expect, it } from 'vitest';
import { printf } from '../src/commands/printf.ts';
import { makeCtx } from './_ctx.ts';

describe('printf', () => {
  it('%s\\n renders the arg followed by a real newline', async () => {
    // Failure mode: passing \n through literally, or appending an echo-style
    // newline beyond the one in FORMAT.
    const { ctx, out, err } = makeCtx();
    const code = await printf(['%s\\n', 'hi'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('hi\n');
    expect(err()).toBe('');
  });

  it('%d formats an integer argument', async () => {
    // Failure mode: not parsing the numeric conversion at all.
    const { ctx, out } = makeCtx();
    const code = await printf(['%d', '42'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('42');
  });

  it('emits NO trailing newline unless FORMAT contains one (printf != echo)', async () => {
    // Failure mode: copying echo and appending "\n" after the output.
    const { ctx, out } = makeCtx();
    const code = await printf(['%s', 'hi'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('hi');
  });

  it('recycles FORMAT through ARGS until they are consumed (GNU)', async () => {
    // Failure mode: applying FORMAT once and dropping the trailing args.
    const { ctx, out } = makeCtx();
    const code = await printf(['%s ', 'a', 'b', 'c'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('a b c ');
  });

  it('%% emits a single literal percent', async () => {
    // Failure mode: treating %% as a conversion or consuming an arg for it.
    const { ctx, out } = makeCtx();
    const code = await printf(['x%%y'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('x%y');
  });

  it('\\t in FORMAT becomes a real tab', async () => {
    // Failure mode: leaving the backslash-t two-char sequence in the output.
    const { ctx, out } = makeCtx();
    const code = await printf(['a\\tb'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('a\tb');
  });

  it('a missing %s argument substitutes the empty string', async () => {
    // Failure mode: emitting "undefined"/throwing when ARGS run short.
    const { ctx, out } = makeCtx();
    const code = await printf(['[%s]'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('[]');
  });

  it('a missing %d argument substitutes 0', async () => {
    // Failure mode: emitting "NaN"/empty for an absent numeric operand.
    const { ctx, out } = makeCtx();
    const code = await printf(['n=%d'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('n=0');
  });

  it('a non-numeric %d operand writes an error to stderr and exits 1', async () => {
    // Failure mode: silently coercing to NaN / exiting 0 — breaks && / ||.
    const { ctx, out, err } = makeCtx();
    const code = await printf(['%d', 'foo'], ctx);
    expect(code).toBe(1);
    expect(out()).toBe('0'); // GNU still prints 0 for the failed conversion
    expect(err()).toContain('foo');
  });

  it('%x and %o format hex and octal', async () => {
    // Failure mode: ignoring the radix and printing decimal.
    const { ctx, out } = makeCtx();
    const code = await printf(['%x %o', '255', '8'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('ff 10');
  });

  it('%c emits only the first character of its argument', async () => {
    // Failure mode: printing the whole argument like %s.
    const { ctx, out } = makeCtx();
    const code = await printf(['%c', 'abc'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('a');
  });

  it('\\xNN hex escape in FORMAT decodes to the byte', async () => {
    // Failure mode: not handling \x — would leave "x42" in the output.
    const { ctx, out } = makeCtx();
    const code = await printf(['A\\x42C'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('ABC');
  });

  it('%i is an alias for %d', async () => {
    // Failure mode: routing %i to the unimplemented path.
    const { ctx, out } = makeCtx();
    const code = await printf(['%i', '7'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('7');
  });

  it('an empty FORMAT produces no output and exits 0', async () => {
    const { ctx, out } = makeCtx();
    const code = await printf([''], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('');
  });

  it('does not recycle when a pass consumes no argument (no infinite loop)', async () => {
    // Failure mode: a FORMAT with no conversions looping forever over excess
    // args. GNU prints FORMAT once and stops.
    const { ctx, out } = makeCtx();
    const code = await printf(['lit\\n', 'a', 'b'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('lit\n');
  });

  it('throws NotImplementedError for %b (no silent stub)', async () => {
    // Failure mode: silently ignoring %b instead of failing loudly.
    const { ctx } = makeCtx();
    await expect(printf(['%b', 'x'], ctx)).rejects.toBeInstanceOf(NotImplementedError);
  });

  it('the %b NotImplementedError carries a shell.printf.%b feature name', async () => {
    const { ctx } = makeCtx();
    await expect(printf(['%b', 'x'], ctx)).rejects.toMatchObject({ feature: 'shell.printf.%b' });
  });

  it('throws NotImplementedError for a width/precision specifier like %5.2f', async () => {
    // Failure mode: silently dropping the field-width/precision instead of
    // signalling the unimplemented feature.
    const { ctx } = makeCtx();
    await expect(printf(['%5.2f', '1.5'], ctx)).rejects.toBeInstanceOf(NotImplementedError);
  });
});
