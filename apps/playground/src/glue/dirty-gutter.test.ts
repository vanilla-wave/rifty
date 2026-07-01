import { describe, expect, it } from 'vitest';
import { dirtyGutterChanges } from './dirty-gutter.ts';

describe('dirty gutter line marks', () => {
  it('marks additions, modifications, and deletions from two full texts', () => {
    expect(dirtyGutterChanges('', 'a\nb\n')).toEqual([
      { kind: 'added', lineNumber: 1 },
      { kind: 'added', lineNumber: 2 },
    ]);
    expect(dirtyGutterChanges('a\nb\nc\n', 'a\nB\nc\n')).toEqual([
      { kind: 'modified', lineNumber: 2 },
    ]);
    expect(dirtyGutterChanges('a\nb\nc\n', 'a\nc\n')).toEqual([{ kind: 'deleted', lineNumber: 2 }]);
  });

  it('returns no marks for byte-equal texts', () => {
    expect(dirtyGutterChanges('same\n', 'same\n')).toEqual([]);
  });
});
