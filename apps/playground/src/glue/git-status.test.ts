import { describe, expect, it } from 'vitest';
import { porcelainStatusLines, statusEntriesToDelta } from './git-status.ts';

describe('rifty-git status classifier', () => {
  it('uses the same ordered multi-row classifier as the shell builtin', () => {
    expect(porcelainStatusLines('111')).toEqual([]);
    expect(porcelainStatusLines('121')).toEqual([' M']);
    expect(porcelainStatusLines('110')).toEqual(['D ', '??']);
  });

  it('omits clean entries and exposes path/code pairs for the page cache', () => {
    expect(
      statusEntriesToDelta([
        { kind: 'supported', filepath: 'clean.txt', status: '111' },
        { kind: 'supported', filepath: 'edited.txt', status: '121' },
        { kind: 'supported', filepath: 'new.txt', status: '020' },
        { kind: 'supported', filepath: 'recreated.txt', status: '120' },
      ]),
    ).toEqual([
      { kind: 'supported', path: 'edited.txt', code: ' M' },
      { kind: 'supported', path: 'new.txt', code: '??' },
      { kind: 'supported', path: 'recreated.txt', code: 'D ' },
      { kind: 'supported', path: 'recreated.txt', code: '??' },
    ]);
  });

  it('preserves supported siblings and marks only an unsupported matrix path', () => {
    expect(
      statusEntriesToDelta([
        { kind: 'supported', filepath: 'edited.txt', status: '121' },
        { kind: 'unsupported', filepath: 'future.txt', rawStatusMatrixCode: '999' },
        { kind: 'supported', filepath: 'new.txt', status: '020' },
      ]),
    ).toEqual([
      { kind: 'supported', path: 'edited.txt', code: ' M' },
      { kind: 'unsupported', path: 'future.txt', rawStatusMatrixCode: '999' },
      { kind: 'supported', path: 'new.txt', code: '??' },
    ]);
  });

  it('filters only the reserved root .rifty namespace from the legacy feed', () => {
    expect(
      statusEntriesToDelta([
        { kind: 'supported', filepath: '.rifty/private.json', status: '020' },
        { kind: 'unsupported', filepath: '.rifty/future.bin', rawStatusMatrixCode: '999' },
        { kind: 'supported', filepath: 'src/.rifty/ordinary.json', status: '020' },
      ]),
    ).toEqual([
      {
        kind: 'supported',
        path: 'src/.rifty/ordinary.json',
        code: '??',
      },
    ]);
  });
});
