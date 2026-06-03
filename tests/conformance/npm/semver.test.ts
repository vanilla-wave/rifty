import { compare, matchesRange, parse, pickBestVersion } from '@riftydev/npm-client';
import { describe, expect, it } from 'vitest';

describe('semver.parse', () => {
  it('parses major.minor.patch', () => {
    expect(parse('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, pre: '' });
  });
  it('accepts v-prefix', () => {
    expect(parse('v1.0.0')?.major).toBe(1);
  });
  it('captures prerelease', () => {
    expect(parse('1.0.0-rc.1')?.pre).toBe('rc.1');
  });
  it('returns null for nonsense', () => {
    expect(parse('not.a.version')).toBeNull();
  });
});

describe('semver.compare', () => {
  it('orders by major.minor.patch', () => {
    expect(compare('1.0.0', '2.0.0')).toBeLessThan(0);
    expect(compare('1.2.0', '1.1.9')).toBeGreaterThan(0);
    expect(compare('1.0.0', '1.0.0')).toBe(0);
  });
  it('release beats prerelease', () => {
    expect(compare('1.0.0', '1.0.0-rc')).toBeGreaterThan(0);
  });
});

describe('semver.matchesRange', () => {
  it('exact', () => {
    expect(matchesRange('1.2.3', '1.2.3')).toBe(true);
    expect(matchesRange('1.2.4', '1.2.3')).toBe(false);
  });
  it('caret', () => {
    expect(matchesRange('1.2.3', '^1.2.0')).toBe(true);
    expect(matchesRange('1.9.0', '^1.2.0')).toBe(true);
    expect(matchesRange('2.0.0', '^1.2.0')).toBe(false);
    // ^0.x stays within 0.x.y
    expect(matchesRange('0.2.5', '^0.2.0')).toBe(true);
    expect(matchesRange('0.3.0', '^0.2.0')).toBe(false);
  });
  it('tilde', () => {
    expect(matchesRange('1.2.5', '~1.2.0')).toBe(true);
    expect(matchesRange('1.3.0', '~1.2.0')).toBe(false);
  });
  it('x-range', () => {
    expect(matchesRange('1.2.3', '1.x')).toBe(true);
    expect(matchesRange('2.0.0', '1.x')).toBe(false);
    expect(matchesRange('1.2.5', '1.2.x')).toBe(true);
  });
  it('comparator set', () => {
    expect(matchesRange('1.5.0', '>=1.0.0 <2.0.0')).toBe(true);
    expect(matchesRange('2.0.0', '>=1.0.0 <2.0.0')).toBe(false);
  });
  it('union', () => {
    expect(matchesRange('1.0.0', '^1.0.0 || ^2.0.0')).toBe(true);
    expect(matchesRange('2.5.0', '^1.0.0 || ^2.0.0')).toBe(true);
    expect(matchesRange('3.0.0', '^1.0.0 || ^2.0.0')).toBe(false);
  });
  it('wildcards', () => {
    expect(matchesRange('1.0.0', '*')).toBe(true);
    expect(matchesRange('5.0.0', 'latest')).toBe(true);
  });
});

describe('semver.pickBestVersion', () => {
  it('picks the highest matching version', () => {
    expect(pickBestVersion(['1.0.0', '1.1.0', '1.2.0', '2.0.0'], '^1.0.0')).toBe('1.2.0');
  });
  it('returns null when nothing matches', () => {
    expect(pickBestVersion(['1.0.0', '1.1.0'], '^2.0.0')).toBeNull();
  });
});
