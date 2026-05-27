import { describe, expect, it } from 'vitest';
import { compare, matchesRange, pickBestVersion } from './semver.ts';

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

describe('matchesRange — partial bases (the live-express regression)', () => {
  // `parse('4')` used to return null, so `^4` matched nothing and the
  // installer's silent dist-tags.latest fallback resolved express to its
  // newest major (5.x). The fix coerces partial bases via zero-fill so
  // `^4 = >=4.0.0 <5.0.0`. Cases below cover the live-express scenario plus
  // the corner cases npm semver pins down differently from a naive fill.
  it('caret with major-only base covers the full major range', () => {
    expect(matchesRange('4.21.0', '^4')).toBe(true);
    expect(matchesRange('4.0.0', '^4')).toBe(true);
    expect(matchesRange('5.0.0', '^4')).toBe(false);
    expect(matchesRange('3.9.9', '^4')).toBe(false);
  });

  it('caret with major.minor base bounds at next major (not next minor)', () => {
    expect(matchesRange('4.21.0', '^4.21')).toBe(true);
    expect(matchesRange('4.22.0', '^4.21')).toBe(true);
    expect(matchesRange('5.0.0', '^4.21')).toBe(false);
    expect(matchesRange('4.20.0', '^4.21')).toBe(false);
  });

  it('caret with major=0 partial keeps the special-case 0.x semantics', () => {
    // ^0 = >=0.0.0 <1.0.0 (whole 0.x range)
    expect(matchesRange('0.9.0', '^0')).toBe(true);
    expect(matchesRange('1.0.0', '^0')).toBe(false);
    // ^0.2 = >=0.2.0 <0.3.0
    expect(matchesRange('0.2.5', '^0.2')).toBe(true);
    expect(matchesRange('0.3.0', '^0.2')).toBe(false);
    // ^0.0 = >=0.0.0 <0.1.0 (any patch in 0.0.x — different from ^0.0.3!)
    expect(matchesRange('0.0.5', '^0.0')).toBe(true);
    expect(matchesRange('0.1.0', '^0.0')).toBe(false);
    // ^0.0.3 = >=0.0.3 <0.0.4 (locked patch)
    expect(matchesRange('0.0.3', '^0.0.3')).toBe(true);
    expect(matchesRange('0.0.4', '^0.0.3')).toBe(false);
  });

  it('tilde with major-only base behaves like caret (npm semver §~)', () => {
    // ~4 = >=4.0.0 <5.0.0, NOT >=4.0.0 <4.1.0 — easy to get wrong.
    expect(matchesRange('4.21.0', '~4')).toBe(true);
    expect(matchesRange('4.0.0', '~4')).toBe(true);
    expect(matchesRange('5.0.0', '~4')).toBe(false);
  });

  it('tilde with major.minor base bounds at next minor', () => {
    expect(matchesRange('4.1.5', '~4.1')).toBe(true);
    expect(matchesRange('4.2.0', '~4.1')).toBe(false);
    expect(matchesRange('4.0.5', '~4.1')).toBe(false);
  });

  it('bare partial versions act as x-ranges (`4` ≡ `4.x.x`)', () => {
    expect(matchesRange('4.21.0', '4')).toBe(true);
    expect(matchesRange('5.0.0', '4')).toBe(false);
    expect(matchesRange('4.1.5', '4.1')).toBe(true);
    expect(matchesRange('4.2.0', '4.1')).toBe(false);
  });

  it('comparators accept partial bases (`>=14` ≡ `>=14.0.0`)', () => {
    expect(matchesRange('14.0.0', '>=14')).toBe(true);
    expect(matchesRange('14.21.5', '>=14')).toBe(true);
    expect(matchesRange('13.99.0', '>=14')).toBe(false);
    expect(matchesRange('4.0.0', '<5')).toBe(true);
    expect(matchesRange('4.21.0', '<5')).toBe(true);
    expect(matchesRange('5.0.0', '<5')).toBe(false);
  });

  it('pickBestVersion picks the newest 4.x for `^4` from an express-like packument', () => {
    // The exact regression: express had 4.0.0 .. 4.21.2 and 5.x; with the old
    // semver `pickBestVersion(_, '^4')` returned null and the silent fallback
    // resolved 5.2.1. After the fix the picker selects the newest 4.x.
    const versions = ['4.0.0', '4.16.0', '4.17.1', '4.21.0', '4.21.2', '5.0.0', '5.2.1'];
    expect(pickBestVersion(versions, '^4')).toBe('4.21.2');
  });
});
