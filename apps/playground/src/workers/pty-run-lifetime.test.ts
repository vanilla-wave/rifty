import { describe, expect, it } from 'vitest';
import { ptyRunMayOutliveExit } from './pty-run-lifetime.ts';

describe('pty run lifetime classification', () => {
  it.each([
    ['sleep 1 &', true],
    ['echo before ; sleep 1 &', true],
    ['false && sleep 1 &', true],
    ['echo "&"', false],
    [String.raw`echo \&`, false],
    ['echo a && echo b', false],
  ])('%s → mayOutlive=%s', (line, expected) => {
    expect(ptyRunMayOutliveExit(line, {})).toBe(expected);
  });
});
