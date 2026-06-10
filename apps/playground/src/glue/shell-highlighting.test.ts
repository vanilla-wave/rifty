import { expect, it } from 'vitest';
import { shellLineHighlightSpans } from './shell-highlighting.ts';

it('highlights command, string, and shell operators with raw offsets', () => {
  expect(shellLineHighlightSpans("grep 'a b' src/app.ts && echo ok")).toEqual([
    { start: 0, end: 4, foreground: '#7fb2ff' },
    { start: 5, end: 10, foreground: '#c4f042' },
    { start: 22, end: 24, foreground: '#98a1b6' },
    { start: 25, end: 29, foreground: '#7fb2ff' },
  ]);
});

it('keeps escaped quotes inside a double-quoted string span', () => {
  expect(shellLineHighlightSpans('echo "a \\" b"')).toEqual([
    { start: 0, end: 4, foreground: '#7fb2ff' },
    { start: 5, end: 13, foreground: '#c4f042' },
  ]);
});
