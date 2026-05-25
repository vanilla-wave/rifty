import { describe, expect, it } from 'vitest';
import { compare, pickBestVersion } from './semver.ts';

describe('semver compare — pre-release ordering (per semver §11)', () => {
  it('release > prerelease of same version', () => {
    expect(compare('1.0.0', '1.0.0-alpha')).toBeGreaterThan(0);
    expect(compare('1.0.0-alpha', '1.0.0')).toBeLessThan(0);
  });

  it('numeric pre-release identifiers compare numerically (not lexicographically)', () => {
    // The bug: lexicographic puts '10' before '2'. Spec requires 2 < 10 numerically.
    expect(compare('1.0.0-alpha.2', '1.0.0-alpha.10')).toBeLessThan(0);
    expect(compare('1.0.0-alpha.10', '1.0.0-alpha.2')).toBeGreaterThan(0);
    expect(compare('1.0.0-alpha.1', '1.0.0-alpha.2')).toBeLessThan(0);
  });

  it('non-numeric identifiers compare lexicographically', () => {
    expect(compare('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0);
    expect(compare('1.0.0-beta', '1.0.0-alpha')).toBeGreaterThan(0);
  });

  it('numeric identifier has lower precedence than non-numeric', () => {
    // Spec §11.4.3: "Numeric identifiers always have lower precedence than alphanumeric identifiers."
    expect(compare('1.0.0-1', '1.0.0-alpha')).toBeLessThan(0);
    expect(compare('1.0.0-alpha', '1.0.0-1')).toBeGreaterThan(0);
  });

  it('shorter prerelease set < longer with equal prefix (§11.4.4)', () => {
    // "A larger set of pre-release fields has a higher precedence than a smaller set"
    expect(compare('1.0.0-alpha', '1.0.0-alpha.1')).toBeLessThan(0);
    expect(compare('1.0.0-alpha.1', '1.0.0-alpha')).toBeGreaterThan(0);
  });

  it('full example chain from semver spec §11.4', () => {
    // 1.0.0-alpha < 1.0.0-alpha.1 < 1.0.0-alpha.beta < 1.0.0-beta < 1.0.0-beta.2 < 1.0.0-beta.11 < 1.0.0-rc.1 < 1.0.0
    const ordered = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
    ];
    for (let i = 0; i < ordered.length - 1; i++) {
      const a = ordered[i];
      const b = ordered[i + 1];
      if (a === undefined || b === undefined) throw new Error('unreachable');
      expect(compare(a, b), `${a} < ${b}`).toBeLessThan(0);
      expect(compare(b, a), `${b} > ${a}`).toBeGreaterThan(0);
    }
  });
});

describe('pickBestVersion — pre-release sort', () => {
  it('picks numerically highest pre-release identifier (1.0.0-alpha.10 > 1.0.0-alpha.2)', () => {
    const versions = ['1.0.0-alpha.1', '1.0.0-alpha.2', '1.0.0-alpha.10'];
    // The range "1.0.0-alpha" doesn't usually match prereleases by default,
    // so use exact pickBestVersion via passing the full set with a wildcard range.
    expect(pickBestVersion(versions, '*')).toBe('1.0.0-alpha.10');
  });
});
