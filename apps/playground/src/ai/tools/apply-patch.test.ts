import { describe, expect, it } from 'vitest';
import { parseUnifiedPatch, planUnifiedPatch } from './apply-patch.ts';

const FILE = ['function greet() {', "  return 'hello';", '}', ''].join('\n');

function readFrom(files: Record<string, string>): (path: string) => string | null {
  return (path) => files[path] ?? null;
}

describe('parseUnifiedPatch', () => {
  it('parses headers, hunks and dev/null sides', () => {
    const patch = [
      '--- a/src/a.js',
      '+++ b/src/a.js',
      '@@ -1,2 +1,2 @@',
      ' one',
      '-two',
      '+TWO',
      '',
    ].join('\n');
    const files = parseUnifiedPatch(patch);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ oldPath: 'src/a.js', newPath: 'src/a.js' });
    expect(files[0]?.hunks[0]).toMatchObject({
      header: '@@ -1,2 +1,2 @@',
      oldLines: ['one', 'two'],
      newLines: ['one', 'TWO'],
    });
  });

  it('throws on malformed input (no diffs / bad counts)', () => {
    expect(() => parseUnifiedPatch('not a patch')).toThrow(/no file diffs/);
    expect(() => parseUnifiedPatch('--- a/x\n+++ b/x\n@@ -1,3 +1,1 @@\n one\n')).toThrow(
      /declared counts/,
    );
  });
});

describe('planUnifiedPatch', () => {
  it('applies a clean modification', () => {
    const patch = [
      '--- a/greet.js',
      '+++ b/greet.js',
      '@@ -1,3 +1,3 @@',
      ' function greet() {',
      "-  return 'hello';",
      "+  return 'bonjour';",
      ' }',
      '',
    ].join('\n');
    const changes = planUnifiedPatch(patch, readFrom({ 'greet.js': FILE }));
    expect(changes).toEqual([
      {
        path: 'greet.js',
        action: 'write',
        content: ['function greet() {', "  return 'bonjour';", '}', ''].join('\n'),
      },
    ]);
  });

  it('applies with position drift when the exact context matches uniquely', () => {
    const patch = [
      '--- a/greet.js',
      '+++ b/greet.js',
      '@@ -40,3 +40,3 @@', // stale line numbers
      ' function greet() {',
      "-  return 'hello';",
      "+  return 'hi';",
      ' }',
      '',
    ].join('\n');
    const changes = planUnifiedPatch(patch, readFrom({ 'greet.js': FILE }));
    expect(changes[0]?.content).toContain("return 'hi';");
  });

  it('rejects on any hunk mismatch, naming the failing hunk (no fuzz)', () => {
    const patch = [
      '--- a/greet.js',
      '+++ b/greet.js',
      '@@ -1,3 +1,3 @@',
      ' function greet() {',
      "-  return 'HELLO';", // does not match
      "+  return 'hi';",
      ' }',
      '',
    ].join('\n');
    expect(() => planUnifiedPatch(patch, readFrom({ 'greet.js': FILE }))).toThrow(
      /hunk @@ -1,3 \+1,3 @@ does not match the current content of greet\.js/,
    );
  });

  it('rejects an ambiguous drifted hunk instead of guessing', () => {
    const twice = `${FILE}${FILE}`;
    const patch = [
      '--- a/greet.js',
      '+++ b/greet.js',
      '@@ -99,1 +99,1 @@', // wrong position → search → two matches
      "-  return 'hello';",
      "+  return 'hi';",
      '',
    ].join('\n');
    expect(() => planUnifiedPatch(patch, readFrom({ 'greet.js': twice }))).toThrow(/ambiguous/);
  });

  it('creates and deletes files via /dev/null sides', () => {
    const create = [
      '--- /dev/null',
      '+++ b/new.txt',
      '@@ -0,0 +1,2 @@',
      '+alpha',
      '+beta',
      '',
    ].join('\n');
    expect(planUnifiedPatch(create, readFrom({}))).toEqual([
      { path: 'new.txt', action: 'write', content: 'alpha\nbeta\n' },
    ]);

    const remove = [
      '--- a/greet.js',
      '+++ /dev/null',
      '@@ -1,3 +0,0 @@',
      '-function greet() {',
      "-  return 'hello';",
      '-}',
      '',
    ].join('\n');
    expect(planUnifiedPatch(remove, readFrom({ 'greet.js': FILE }))).toEqual([
      { path: 'greet.js', action: 'delete' },
    ]);
  });

  it('rejects the WHOLE patch when a later file fails (no partial apply)', () => {
    const patch = [
      '--- /dev/null',
      '+++ b/ok.txt',
      '@@ -0,0 +1,1 @@',
      '+fine',
      '--- a/missing.js',
      '+++ b/missing.js',
      '@@ -1,1 +1,1 @@',
      '-x',
      '+y',
      '',
    ].join('\n');
    expect(() => planUnifiedPatch(patch, readFrom({}))).toThrow(/missing\.js does not exist/);
  });

  it('honours the no-trailing-newline marker on the new side', () => {
    const patch = [
      '--- /dev/null',
      '+++ b/no-eol.txt',
      '@@ -0,0 +1,1 @@',
      '+solo',
      '\\ No newline at end of file',
      '',
    ].join('\n');
    expect(planUnifiedPatch(patch, readFrom({}))).toEqual([
      { path: 'no-eol.txt', action: 'write', content: 'solo' },
    ]);
  });
});
