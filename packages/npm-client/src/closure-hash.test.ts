import { describe, expect, it } from 'vitest';
import { closureHashOf } from './closure-hash.ts';
import type { Lockfile } from './linker.ts';

function lf(packages: Lockfile['packages']): Lockfile {
  return { name: 'r', version: '0.0.0', lockfileVersion: 3, requires: true, packages };
}

describe('closureHashOf', () => {
  it('is identical for the same closure regardless of package key order', async () => {
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
    expect(await closureHashOf(a)).toBe(await closureHashOf(b));
  });

  it('differs when any pinned integrity differs', async () => {
    const a = lf({ 'node_modules/x': { version: '1.0.0', integrity: 'sha512-x' } });
    const b = lf({ 'node_modules/x': { version: '1.0.0', integrity: 'sha512-DIFFERENT' } });
    expect(await closureHashOf(a)).not.toBe(await closureHashOf(b));
  });

  it('emits the `sha256-<base64>` shape (byte-matches Node digest(base64))', async () => {
    const hash = await closureHashOf(lf({ 'node_modules/x': { version: '1.0.0' } }));
    expect(hash).toMatch(/^sha256-[A-Za-z0-9+/]+=*$/);
  });
});
