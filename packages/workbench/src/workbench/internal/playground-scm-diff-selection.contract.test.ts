import { describe, expect, it } from 'vitest';
import { selectPlaygroundScmDiffSources } from './playground-scm.ts';

type Area = 'staged' | 'working';
type OriginalSource = 'head' | 'index' | 'empty';
type ModifiedSource = 'index' | 'working' | 'empty';

interface SelectionCase {
  readonly code: string;
  readonly area: Area;
  readonly original: OriginalSource;
  readonly modified: ModifiedSource;
}

const SELECTION_MATRIX: readonly SelectionCase[] = Object.freeze([
  { code: 'M ', area: 'staged', original: 'head', modified: 'index' },
  { code: 'A ', area: 'staged', original: 'empty', modified: 'index' },
  { code: 'D ', area: 'staged', original: 'head', modified: 'empty' },
  { code: 'AM', area: 'staged', original: 'empty', modified: 'index' },
  { code: 'MD', area: 'staged', original: 'head', modified: 'index' },
  { code: ' M', area: 'working', original: 'head', modified: 'working' },
  { code: 'MM', area: 'working', original: 'index', modified: 'working' },
  { code: '??', area: 'working', original: 'empty', modified: 'working' },
  { code: ' D', area: 'working', original: 'head', modified: 'empty' },
  { code: 'AM', area: 'working', original: 'index', modified: 'working' },
  { code: 'MD', area: 'working', original: 'index', modified: 'empty' },
]);

describe('Workbench SCM diff source selection', () => {
  it.each(SELECTION_MATRIX)('$area $code selects $original -> $modified', (testCase) => {
    const first = selectPlaygroundScmDiffSources(testCase);
    const second = selectPlaygroundScmDiffSources(testCase);
    expect(first).toEqual({
      original: testCase.original,
      modified: testCase.modified,
    });
    expect(second).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it.each([
    { code: '??', area: 'staged' },
    { code: 'M ', area: 'working' },
    { code: ' M', area: 'staged' },
    { code: '  ', area: 'working' },
    { code: 'XY', area: 'working' },
  ] as const)('rejects impossible $area $code inputs', (change) => {
    expect(() => selectPlaygroundScmDiffSources(change)).toThrowError(
      new TypeError('Invalid SCM diff input'),
    );
  });
});
