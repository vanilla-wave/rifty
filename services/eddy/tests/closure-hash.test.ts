/**
 * Drift tripwire: `@riftydev/eddy`'s SYNC `closureHashOf` (compat string API,
 * node:crypto) must byte-match the shared async one in `@riftydev/npm-client`
 * (WebCrypto) — both hash the same `canonicalClosureJson`.
 */
import { type Lockfile, closureHashOf as closureHashOfAsync } from '@riftydev/npm-client';
import { describe, expect, it } from 'vitest';
import { closureHashOf } from '../src/closure-hash.ts';

const LOCKFILE: Lockfile = {
  name: 'app',
  version: '1.0.0',
  lockfileVersion: 3,
  requires: true,
  packages: {
    '': { name: 'app', version: '1.0.0' },
    'node_modules/debug': {
      version: '4.4.1',
      resolved: 'http://r/debug/-/debug-4.4.1.tgz',
      integrity: 'sha512-a',
      dependencies: { ms: '^2.1.3' },
    },
    'node_modules/ms': {
      version: '2.1.3',
      resolved: 'http://r/ms/-/ms-2.1.3.tgz',
      integrity: 'sha512-b',
    },
    'node_modules/debug/node_modules/ms': {
      version: '2.0.0',
      resolved: 'http://r/ms/-/ms-2.0.0.tgz',
      integrity: 'sha512-c',
    },
  },
} as unknown as Lockfile;

describe('eddy sync closureHashOf (compat API)', () => {
  it('returns a plain string byte-identical to the shared async hash', async () => {
    const sync = closureHashOf(LOCKFILE);
    expect(typeof sync).toBe('string');
    expect(sync).toMatch(/^sha256-/);
    expect(sync).toBe(await closureHashOfAsync(LOCKFILE));
  });
});
