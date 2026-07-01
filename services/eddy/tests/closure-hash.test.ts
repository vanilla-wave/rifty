import type { Lockfile } from '@riftydev/npm-client';
import { describe, expect, it } from 'vitest';
import { closureHashOf } from '../src/closure-hash.ts';

function lf(packages: Lockfile['packages']): Lockfile {
  return { name: 'r', version: '0.0.0', lockfileVersion: 3, requires: true, packages };
}

describe('closureHashOf', () => {
  it('is identical for the same closure regardless of package key order', () => {
    const a = lf({
      '': { version: '0.0.0', dependencies: { x: '1.0.0', y: '2.0.0' } },
      'node_modules/x': { version: '1.0.0', integrity: 'sha512-x' },
      'node_modules/y': { version: '2.0.0', integrity: 'sha512-y' },
    });
    const b = lf({
      'node_modules/y': { version: '2.0.0', integrity: 'sha512-y' },
      'node_modules/x': { version: '1.0.0', integrity: 'sha512-x' },
      '': { version: '0.0.0', dependencies: { x: '1.0.0', y: '2.0.0' } },
    });
    expect(closureHashOf(a)).toBe(closureHashOf(b));
  });

  it('differs when any pinned integrity differs', () => {
    const a = lf({ 'node_modules/x': { version: '1.0.0', integrity: 'sha512-x' } });
    const b = lf({ 'node_modules/x': { version: '1.0.0', integrity: 'sha512-DIFFERENT' } });
    expect(closureHashOf(a)).not.toBe(closureHashOf(b));
  });
});
