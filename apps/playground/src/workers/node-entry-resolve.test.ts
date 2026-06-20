import { describe, expect, it } from 'vitest';
import { resolveNodeEntry } from './node-entry-resolve.ts';

describe('resolveNodeEntry', () => {
  it('absolutizes a relative path against cwd', () => {
    expect(resolveNodeEntry('/w', 'app.js')).toEqual({ ok: true, path: '/w/app.js' });
  });

  it('returns ok for a missing file too — the loader emits the real Node MODULE_NOT_FOUND', () => {
    // backlog/runtime-js/node-entry-miss-node-shape: the owner no longer
    // pre-checks existence (the old terse `node: cannot find module` form). A
    // missing entry now flows into runNodeEntry → the module loader, which throws
    // real Node's `Error: Cannot find module '<abs>' … { code:'MODULE_NOT_FOUND',
    // requireStack: [] }` on the child stderr.
    expect(resolveNodeEntry('/w', 'nope.js')).toEqual({ ok: true, path: '/w/nope.js' });
  });

  it('keeps an absolute path as-is', () => {
    expect(resolveNodeEntry('/w', '/abs/app.js')).toEqual({ ok: true, path: '/abs/app.js' });
  });

  it('errors with usage when no file is given', () => {
    expect(resolveNodeEntry('/w', undefined)).toEqual({
      ok: false,
      message: 'node: missing entry file\nUsage: node <file> [args]\n',
    });
    expect(resolveNodeEntry('/w', '')).toEqual({
      ok: false,
      message: 'node: missing entry file\nUsage: node <file> [args]\n',
    });
  });
});
