import { describe, expect, it } from 'vitest';
import {
  bundleUrlFor,
  canonicalEddyRequestKey,
  eddyRequestFromPackageJson,
} from './eddy-request.ts';

describe('eddyRequestFromPackageJson — mirrors normalizeInstallArgs', () => {
  it('merges devDependencies under dependencies (dependencies win) and carves out optionals', () => {
    const body = eddyRequestFromPackageJson(
      JSON.stringify({
        dependencies: { a: '^1', both: '2.0.0' },
        devDependencies: { dev: '^3', both: '1.0.0' },
        optionalDependencies: { opt: '^4', a: '^1' },
      }),
    );
    expect(body).toEqual({
      // `a` is optional → carved out of the merged map entirely.
      dependencies: { dev: '^3', both: '2.0.0' },
      optionalDependencies: { opt: '^4', a: '^1' },
    });
  });

  it('carries overrides only when non-empty', () => {
    const withOverrides = eddyRequestFromPackageJson(
      JSON.stringify({ dependencies: { a: '^1' }, overrides: { esbuild: 'npm:x@1' } }),
    );
    expect(withOverrides?.overrides).toEqual({ esbuild: 'npm:x@1' });
    const without = eddyRequestFromPackageJson(JSON.stringify({ dependencies: { a: '^1' } }));
    expect(without && 'overrides' in without).toBe(false);
  });

  it('returns null on shapes the installer would reject (never throws)', () => {
    expect(eddyRequestFromPackageJson('{not json')).toBeNull();
    expect(eddyRequestFromPackageJson('[]')).toBeNull();
    expect(
      eddyRequestFromPackageJson(JSON.stringify({ dependencies: { a: { nested: true } } })),
    ).toBeNull();
    expect(eddyRequestFromPackageJson(JSON.stringify({ dependencies: 'oops' }))).toBeNull();
  });
});

describe('canonicalEddyRequestKey', () => {
  it('is insertion-order independent', () => {
    const a = canonicalEddyRequestKey({
      dependencies: { x: '1', y: '2' },
      optionalDependencies: {},
      overrides: { o1: 'a', o2: 'b' },
    });
    const b = canonicalEddyRequestKey({
      dependencies: { y: '2', x: '1' },
      optionalDependencies: {},
      overrides: { o2: 'b', o1: 'a' },
    });
    expect(a).toBe(b);
  });

  it('differs on dep-set and on prefer', () => {
    const base = { dependencies: { x: '1' }, optionalDependencies: {} };
    expect(canonicalEddyRequestKey(base)).not.toBe(
      canonicalEddyRequestKey({ ...base, dependencies: { x: '2' } }),
    );
    expect(canonicalEddyRequestKey(base, 'cached')).not.toBe(
      canonicalEddyRequestKey(base, 'online'),
    );
  });
});

describe('bundleUrlFor', () => {
  it('strips trailing slashes and percent-encodes the hash', () => {
    expect(bundleUrlFor('https://eddy.test//', 'sha256-ab/cd+ef=')).toBe(
      'https://eddy.test/bundle/sha256-ab%2Fcd%2Bef%3D',
    );
  });
});
