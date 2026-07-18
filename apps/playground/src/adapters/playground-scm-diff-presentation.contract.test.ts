import { describe, expect, it } from 'vitest';
import type {
  PlaygroundScmBlob,
  PlaygroundScmDiff,
  PlaygroundScmSupportedChange,
} from '../workbench/playground.ts';
import { playgroundScmDiffPresentation } from './playground-scm-diff-presentation.ts';

function blob(source: PlaygroundScmBlob['source']): PlaygroundScmBlob {
  return Object.freeze({ source, bytes: new Uint8Array() });
}

function presentation(
  area: PlaygroundScmSupportedChange['area'],
  original: PlaygroundScmBlob['source'],
) {
  const change: PlaygroundScmSupportedChange = Object.freeze({
    path: '/README.md',
    code: 'MM',
    area,
  });
  const diff: PlaygroundScmDiff = Object.freeze({
    original: blob(original),
    modified: blob(area === 'staged' ? 'index' : 'working'),
  });
  return playgroundScmDiffPresentation('README.md', change, diff);
}

describe('Playground SCM diff presentation', () => {
  it('labels staged blobs as HEAD ↔ Index even when either blob is empty', () => {
    expect(presentation('staged', 'head')).toEqual({
      title: 'README.md ↔ Index',
      originalTitle: 'HEAD',
      modifiedTitle: 'Index',
    });
    expect(presentation('staged', 'empty')).toEqual({
      title: 'README.md ↔ Index',
      originalTitle: 'HEAD',
      modifiedTitle: 'Index',
    });
  });

  it('labels every worktree sibling as Working Tree with its exact baseline', () => {
    for (const original of ['head', 'empty'] as const) {
      expect(presentation('working', original)).toEqual({
        title: 'README.md ↔ Working Tree',
        originalTitle: 'HEAD',
        modifiedTitle: 'Working Tree',
      });
    }
    expect(presentation('working', 'index')).toEqual({
      title: 'README.md ↔ Working Tree',
      originalTitle: 'Index',
      modifiedTitle: 'Working Tree',
    });
  });
});
