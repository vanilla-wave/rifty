/**
 * Tests for the `basename` builtin. Pure node:path-style string logic (no VFS
 * read); each case pins a GNU-faithful contract from the spec.
 */

import { NotImplementedError } from '@riftydev/io';
import { describe, expect, it } from 'vitest';
import { basename } from '../src/commands/basename.ts';
import { makeCtx } from './_ctx.ts';

describe('basename', () => {
  it('strips the leading directory: /a/b/c.txt => c.txt', async () => {
    const { ctx, out, err } = makeCtx();
    const code = await basename(['/a/b/c.txt'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('c.txt\n');
    expect(err()).toBe('');
  });

  it('2-arg form strips a trailing SUFFIX: /a/b/c.txt .txt => c', async () => {
    const { ctx, out } = makeCtx();
    const code = await basename(['/a/b/c.txt', '.txt'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('c\n');
  });

  it('never reduces the name to empty when the whole name equals SUFFIX', async () => {
    // GNU: `basename c.txt c.txt` keeps `c.txt` (stripping would empty it).
    const { ctx, out } = makeCtx();
    const code = await basename(['c.txt', 'c.txt'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('c.txt\n');
  });

  it('honours a trailing slash: /a/b/ => b', async () => {
    const { ctx, out } = makeCtx();
    const code = await basename(['/a/b/'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('b\n');
  });

  it('root collapses to /, not empty: basename / => /', async () => {
    // VFS basename('/') returns '' — the command must restore GNU's '/'.
    const { ctx, out } = makeCtx();
    const code = await basename(['/'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('/\n');
  });

  it('-a treats every arg as a name, one per line', async () => {
    const { ctx, out } = makeCtx();
    const code = await basename(['-a', '/x/a', '/y/b'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('a\nb\n');
  });

  it('-a does NOT consume a second arg as a suffix', async () => {
    // Without -a this would be NAME SUFFIX; with -a both are names.
    const { ctx, out } = makeCtx();
    const code = await basename(['-a', '/p/a.txt', '/q/b.txt'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('a.txt\nb.txt\n');
  });

  it('-s SUFFIX implies -a and strips SUFFIX from each name', async () => {
    const { ctx, out } = makeCtx();
    const code = await basename(['-s', '.txt', '/p/a.txt', '/q/b.txt'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('a\nb\n');
  });

  it('exits 1 with a usage error and no stdout when no operands are given', async () => {
    const { ctx, out, err } = makeCtx();
    const code = await basename([], ctx);
    expect(code).toBe(1);
    expect(out()).toBe('');
    expect(err()).not.toBe('');
  });

  it('exits 1 when -s is given without a SUFFIX operand', async () => {
    const { ctx, out, err } = makeCtx();
    const code = await basename(['-s'], ctx);
    expect(code).toBe(1);
    expect(out()).toBe('');
    expect(err()).not.toBe('');
  });

  it('exits 1 when the 1-arg/2-arg form is given too many operands', async () => {
    // Without -a/-s, more than NAME SUFFIX is a usage error in GNU.
    const { ctx, out, err } = makeCtx();
    const code = await basename(['a', 'b', 'c'], ctx);
    expect(code).toBe(1);
    expect(out()).toBe('');
    expect(err()).not.toBe('');
  });

  it('throws NotImplementedError for the unimplemented -z flag', async () => {
    const { ctx } = makeCtx();
    await expect(basename(['-z', '/a/b'], ctx)).rejects.toBeInstanceOf(NotImplementedError);
  });
});
