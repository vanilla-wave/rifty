/**
 * Unit tests for the `echo` builtin. Each case pins a specific GNU-echo
 * behaviour from the spec; the NotImplementedError case guards the no-silent-
 * stub rule for an unsupported flag.
 */

import { NotImplementedError } from '@riftydev/io';
import { describe, expect, it } from 'vitest';
import { echo } from '../src/commands/echo.ts';
import { makeCtx } from './_ctx.ts';

describe('echo', () => {
  it('joins args with single spaces and appends a trailing newline', async () => {
    const { ctx, out, err } = makeCtx();
    const code = await echo(['hello', 'world'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('hello world\n');
    expect(err()).toBe('');
  });

  it('-n suppresses the trailing newline', async () => {
    // Failure mode: still emitting "\n" after the last arg.
    const { ctx, out } = makeCtx();
    const code = await echo(['-n', 'hi'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('hi');
  });

  it('-e interprets backslash escapes into real control characters', async () => {
    // Failure mode: passing \t / \n through literally instead of rendering them.
    const { ctx, out } = makeCtx();
    const code = await echo(['-e', 'a\\tb\\nc'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('a\tb\nc\n');
  });

  it('-E keeps escapes literal (the default)', async () => {
    // Failure mode: interpreting \t when escapes are explicitly disabled.
    const { ctx, out } = makeCtx();
    const code = await echo(['-E', 'a\\tb'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('a\\tb\n');
  });

  it('without -e, escapes are literal by default', async () => {
    // Failure mode: defaulting to escape interpretation (xpg_echo-style).
    const { ctx, out } = makeCtx();
    const code = await echo(['a\\tb'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('a\\tb\n');
  });

  it('stops flag parsing at the first non-flag arg (echo hi -n => "hi -n")', async () => {
    // Failure mode: treating a trailing -n as a flag and dropping the newline.
    const { ctx, out } = makeCtx();
    const code = await echo(['hi', '-n'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('hi -n\n');
  });

  it('combines -n and -e in the leading flag run', async () => {
    // Failure mode: a bundled/sequential flag run not honouring both options.
    const { ctx, out } = makeCtx();
    const code = await echo(['-n', '-e', 'x\\ty'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('x\ty');
  });

  it('always exits 0', async () => {
    const { ctx } = makeCtx();
    expect(await echo([], ctx)).toBe(0);
    expect(await echo(['anything'], ctx)).toBe(0);
  });

  it('throws NotImplementedError for an unimplemented flag (no silent stub)', async () => {
    // Failure mode: silently ignoring/printing an unknown leading flag instead
    // of failing loudly (CLAUDE.md no-silent-stub rule). `-e` enables escape
    // interpretation of \0NNN which GNU echo supports but we do not yet.
    const { ctx } = makeCtx();
    await expect(echo(['-n', '-x', 'rest'], ctx)).rejects.toBeInstanceOf(NotImplementedError);
  });

  it('the NotImplementedError carries a shell.echo.<flag> feature name', async () => {
    const { ctx } = makeCtx();
    await expect(echo(['-x'], ctx)).rejects.toMatchObject({ feature: 'shell.echo.-x' });
  });
});
