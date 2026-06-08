/**
 * Tests for the `dirname` builtin. Pure string logic (no VFS read); each case
 * pins a GNU-faithful contract from the spec.
 */

import { NotImplementedError } from '@riftydev/io';
import { describe, expect, it } from 'vitest';
import { dirname } from '../src/commands/dirname.ts';
import { makeCtx } from './_ctx.ts';

describe('dirname', () => {
  it('strips the last component: /a/b/c => /a/b', async () => {
    const { ctx, out, err } = makeCtx();
    const code = await dirname(['/a/b/c'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('/a/b\n');
    expect(err()).toBe('');
  });

  it('bare name has no directory: c => .', async () => {
    // Failure mode: emitting '' or 'c' instead of GNU's '.'.
    const { ctx, out } = makeCtx();
    const code = await dirname(['c'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('.\n');
  });

  it('root is its own parent: / => /', async () => {
    // Failure mode: collapsing '/' to '' or '.'.
    const { ctx, out } = makeCtx();
    const code = await dirname(['/'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('/\n');
  });

  it('drops trailing slash then the component: /a/b/ => /a', async () => {
    // Failure mode: normalizing the trailing slash away first would yield /a/b
    // (VFS dirname does exactly that). GNU strips trailing slashes, then strips
    // the last component, giving /a.
    const { ctx, out } = makeCtx();
    const code = await dirname(['/a/b/'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('/a\n');
  });

  it('emits one result per line for multiple NAMEs', async () => {
    // Failure mode: only handling the first arg, or joining with a space.
    const { ctx, out } = makeCtx();
    const code = await dirname(['/a/b/c', 'd', '/x/y/'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe('/a/b\n.\n/x\n');
  });

  it('exits 1 with a usage error and no stdout when no operands are given', async () => {
    const { ctx, out, err } = makeCtx();
    const code = await dirname([], ctx);
    expect(code).toBe(1);
    expect(out()).toBe('');
    expect(err()).not.toBe('');
  });

  it('throws NotImplementedError for the unimplemented -z flag', async () => {
    const { ctx } = makeCtx();
    await expect(dirname(['-z', '/a/b'], ctx)).rejects.toBeInstanceOf(NotImplementedError);
  });
});
