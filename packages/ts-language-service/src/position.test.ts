import { describe, expect, it } from 'vitest';
import { offsetToPosition, positionToOffset } from './position.ts';

// Multi-line text; "\n" separators at offsets 5 and 11.
//   line 0: "hello"  offsets 0..4, "\n" at 5
//   line 1: "world"  offsets 6..10, "\n" at 11
//   line 2: "!"      offset 12
const TEXT = 'hello\nworld\n!';

describe('offsetToPosition / positionToOffset (0-based, LSP)', () => {
  it('start of file → line 0, character 0', () => {
    expect(offsetToPosition(TEXT, 0)).toEqual({ line: 0, character: 0 });
  });

  it('mid first line', () => {
    expect(offsetToPosition(TEXT, 3)).toEqual({ line: 0, character: 3 });
  });

  it('the newline char itself counts as end-of-line on its line', () => {
    // offset 5 is the "\n" terminating line 0 → still line 0, char 5
    expect(offsetToPosition(TEXT, 5)).toEqual({ line: 0, character: 5 });
  });

  it('first char after a newline → next line, character 0', () => {
    expect(offsetToPosition(TEXT, 6)).toEqual({ line: 1, character: 0 });
  });

  it('second line interior', () => {
    expect(offsetToPosition(TEXT, 9)).toEqual({ line: 1, character: 3 });
  });

  it('third line', () => {
    expect(offsetToPosition(TEXT, 12)).toEqual({ line: 2, character: 0 });
  });

  it('offset === text length → position one past the last char', () => {
    expect(offsetToPosition(TEXT, TEXT.length)).toEqual({ line: 2, character: 1 });
  });

  it('round-trips for every offset including across newlines', () => {
    for (let off = 0; off <= TEXT.length; off++) {
      const pos = offsetToPosition(TEXT, off);
      expect(positionToOffset(TEXT, pos), `offset ${off}`).toBe(off);
    }
  });

  it('positionToOffset is the inverse for explicit cross-newline positions', () => {
    expect(positionToOffset(TEXT, { line: 1, character: 0 })).toBe(6);
    expect(positionToOffset(TEXT, { line: 2, character: 1 })).toBe(13);
  });
});
