import type { PlaygroundScmDiff, PlaygroundScmSupportedChange } from '../workbench/playground.ts';

export interface PlaygroundScmDiffPresentation {
  readonly title: string;
  readonly originalTitle: 'HEAD' | 'Index';
  readonly modifiedTitle: 'Index' | 'Working Tree';
}

/** One semantic label mapping for every staged/working SCM diff. */
export function playgroundScmDiffPresentation(
  fileName: string,
  change: PlaygroundScmSupportedChange,
  diff: PlaygroundScmDiff,
): PlaygroundScmDiffPresentation {
  const modifiedTitle = change.area === 'staged' ? 'Index' : 'Working Tree';
  const originalTitle =
    change.area === 'working' && diff.original.source === 'index' ? 'Index' : 'HEAD';
  return Object.freeze({
    title: `${fileName} ↔ ${modifiedTitle}`,
    originalTitle,
    modifiedTitle,
  });
}
