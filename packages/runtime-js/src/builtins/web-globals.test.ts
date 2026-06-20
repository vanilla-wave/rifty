import { describe, expect, it } from 'vitest';
import { installWebGlobals } from './web-globals.ts';

describe('installWebGlobals', () => {
  it('installs the `global` self-alias (global === target)', () => {
    // The parity runner runs in real Node where `global` already exists, so this
    // install is unit-tested directly (a bare-`global` parity case would be
    // masked by Node's own global).
    const fake: Record<string, unknown> = {};
    installWebGlobals(fake);
    expect(fake.global).toBe(fake);
  });

  it('does NOT install a `scheduler` global (Node v24 exposes none)', () => {
    const fake: Record<string, unknown> = {};
    installWebGlobals(fake);
    expect('scheduler' in fake).toBe(false);
  });
});
