import { describe, expect, it } from 'vitest';
import { planUnifiedPatch } from './apply-patch.ts';

describe('unified patch validation', () => {
  const read = (path: string) => (path === 'sample.txt' ? 'alpha\nbeta\n' : null);

  it('matches git apply for a zero-context insertion beyond the file', () => {
    expect(
      planUnifiedPatch('--- a/sample.txt\n+++ b/sample.txt\n@@ -100,0 +101 @@\n+wrong\n', read),
    ).toEqual([{ path: 'sample.txt', action: 'write', content: 'alpha\nbeta\nwrong\n' }]);
  });

  it('does not delete unmentioned file content from a partial deletion diff', () => {
    expect(() =>
      planUnifiedPatch('--- a/sample.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-alpha\n', read),
    ).toThrow();
  });

  it('applies complete deletion and exact replacements', () => {
    expect(
      planUnifiedPatch('--- a/sample.txt\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-alpha\n-beta\n', read),
    ).toEqual([{ path: 'sample.txt', action: 'delete' }]);
    expect(
      planUnifiedPatch(
        '--- a/sample.txt\n+++ b/sample.txt\n@@ -1,2 +1,2 @@\n alpha\n-beta\n+gamma\n',
        read,
      ),
    ).toEqual([{ path: 'sample.txt', action: 'write', content: 'alpha\ngamma\n' }]);
  });

  it('retains the new-side newline when replacing a file without a final newline', () => {
    expect(
      planUnifiedPatch(
        '--- a/sample.txt\n+++ b/sample.txt\n@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n',
        () => 'old',
      ),
    ).toEqual([{ path: 'sample.txt', action: 'write', content: 'new\n' }]);
  });

  it('carries earlier hunk offsets when later target lines are identical', () => {
    expect(
      planUnifiedPatch(
        '--- a/sample.txt\n+++ b/sample.txt\n@@ -1 +1,2 @@\n a\n+added\n@@ -3 +4 @@\n-same\n+changed\n',
        () => 'a\nsame\nsame\nz\n',
      ),
    ).toEqual([{ path: 'sample.txt', action: 'write', content: 'a\nadded\nsame\nchanged\nz\n' }]);
  });

  it('decodes git quoted UTF-8 paths instead of creating a different filename', () => {
    expect(
      planUnifiedPatch(
        '--- /dev/null\n+++ "b/\\321\\204\\320\\260\\320\\271\\320\\273.txt"\n@@ -0,0 +1 @@\n+text\n',
        () => null,
      ),
    ).toEqual([{ path: 'файл.txt', action: 'write', content: 'text\n' }]);
  });

  it('refuses a mixed text/binary patch before planning a partial success', () => {
    expect(() =>
      planUnifiedPatch(
        '--- a/sample.txt\n+++ b/sample.txt\n@@ -1,2 +1,2 @@\n alpha\n-beta\n+gamma\nGIT binary patch\nliteral 1\n',
        read,
      ),
    ).toThrow(/binary/i);
  });
});
