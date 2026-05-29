import { describe, expect, it } from 'vitest';
import { matchesRange, pickBestVersion } from './semver.ts';

/**
 * npm's prerelease-exclusion rule (node-semver): a version carrying a
 * prerelease tag (e.g. `5.0.0-beta.3`) only satisfies a range if at least one
 * comparator in the matching branch has the SAME [major,minor,patch] tuple AND
 * a prerelease tag. Without this, `^4` greedily matched `5.0.0-beta.3` and the
 * installer resolved `express: ^4` to an express 5 beta — dragging in
 * body-parser@2-beta + raw-body@3-beta and breaking the body-parser callback
 * API. Found by running real express end-to-end.
 */
describe('semver — prerelease exclusion', () => {
  it('a caret range does NOT match a prerelease of the next major', () => {
    expect(matchesRange('5.0.0-beta.3', '^4')).toBe(false);
    expect(matchesRange('5.0.0-beta.1', '^4.21.2')).toBe(false);
  });

  it('pickBestVersion(^4) prefers the stable 4.x over a 5.0.0 prerelease', () => {
    expect(pickBestVersion(['4.18.0', '4.21.2', '5.0.0-beta.3', '5.1.0'], '^4')).toBe('4.21.2');
  });

  it('x-ranges and exacts exclude unrelated prereleases', () => {
    expect(matchesRange('1.2.3-alpha', '1.x')).toBe(false);
    expect(matchesRange('2.0.0-beta.2', '1.20.3')).toBe(false);
    expect(matchesRange('2.0.0-beta.2', '>=1.0.0 <2.0.0')).toBe(false);
  });

  it('still matches a prerelease when a comparator targets the same tuple with a prerelease', () => {
    expect(matchesRange('5.0.0-beta.3', '^5.0.0-beta.1')).toBe(true);
    expect(matchesRange('5.0.0-beta.3', '>=5.0.0-beta.1 <6.0.0')).toBe(true);
    // ...but a prerelease BELOW the comparator's prerelease is still excluded.
    expect(matchesRange('5.0.0-beta.0', '^5.0.0-beta.1')).toBe(false);
  });

  it('stable versions are unaffected', () => {
    expect(matchesRange('4.21.2', '^4')).toBe(true);
    expect(matchesRange('1.20.3', '1.20.3')).toBe(true);
    expect(pickBestVersion(['4.18.0', '4.21.2'], '^4')).toBe('4.21.2');
  });
});
