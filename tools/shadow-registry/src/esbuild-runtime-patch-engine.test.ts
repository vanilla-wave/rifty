import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface PatchAnchor {
  readonly id: string;
  readonly hunk?: string;
  readonly anchor: string;
}

interface TextPatch extends PatchAnchor {
  readonly replacement: string;
}

interface Span {
  readonly start: number;
  readonly end: number;
}

interface InspectedAnchor {
  readonly id: string;
  readonly hunk: string;
  readonly inputSpan: Span;
  readonly beforeSha256: string;
}

interface AppliedPatch extends InspectedAnchor {
  readonly outputSpan: Span;
  readonly afterSha256: string;
}

interface PatchEngineModule {
  readonly ESBUILD_RUNTIME_PATCH_IDS: readonly string[];
  readonly ESBUILD_RUNTIME_PATCH_ANCHORS: readonly PatchAnchor[];
  inspectExactTextPatchAnchors(
    source: string,
    patches: readonly PatchAnchor[],
  ): {
    readonly sourceSha256: string;
    readonly anchors: readonly InspectedAnchor[];
  };
  applyExactTextPatches(
    source: string,
    patches: readonly TextPatch[],
  ): {
    readonly sourceSha256: string;
    readonly output: string;
    readonly outputSha256: string;
    readonly patches: readonly AppliedPatch[];
  };
}

const engineUrl = new URL('../tools/esbuild-exact-patcher.mjs', import.meta.url);
const engine = (await import(/* @vite-ignore */ engineUrl.href)) as unknown as PatchEngineModule;
const {
  ESBUILD_RUNTIME_PATCH_ANCHORS,
  ESBUILD_RUNTIME_PATCH_IDS,
  applyExactTextPatches,
  inspectExactTextPatchAnchors,
} = engine;

const policy = JSON.parse(
  readFileSync(new URL('../esbuild-runtime-policy.json', import.meta.url), 'utf8'),
) as { readonly patches?: unknown };
if (!Array.isArray(policy.patches) || !policy.patches.every((id) => typeof id === 'string')) {
  throw new Error('esbuild runtime policy: patches must be a string array');
}
const RATIFIED_PATCH_IDS = policy.patches as readonly string[];

const require = createRequire(import.meta.url);
const esbuildWasmRoot = dirname(require.resolve('esbuild-wasm/package.json'));
const upstreamBrowserCjs = readFileSync(join(esbuildWasmRoot, 'lib/browser.js'), 'utf8');

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

describe('exact textual patch engine', () => {
  const source = 'AA[first]BB[second]CC';
  const patches = [
    { id: 'second', anchor: '[second]', replacement: 'TWO' },
    { id: 'first', anchor: '[first]', replacement: 'ONE' },
  ] as const;

  it('applies by immutable source spans while preserving declared patch order in the audit', () => {
    const result = applyExactTextPatches(source, patches);
    expect(result.output).toBe('AAONEBBTWOCC');
    expect(result.sourceSha256).toBe(sha256(source));
    expect(result.outputSha256).toBe(sha256(result.output));
    expect(result.patches).toEqual([
      {
        id: 'second',
        hunk: 'main',
        inputSpan: { start: 11, end: 19 },
        outputSpan: { start: 7, end: 10 },
        beforeSha256: sha256('[second]'),
        afterSha256: sha256('TWO'),
      },
      {
        id: 'first',
        hunk: 'main',
        inputSpan: { start: 2, end: 9 },
        outputSpan: { start: 2, end: 5 },
        beforeSha256: sha256('[first]'),
        afterSha256: sha256('ONE'),
      },
    ]);
  });

  it('is deterministic for the same source and ordered plan', () => {
    expect(applyExactTextPatches(source, patches)).toEqual(applyExactTextPatches(source, patches));
  });

  it('loud-fails a missing anchor with its patch id', () => {
    expect(() =>
      inspectExactTextPatchAnchors('alpha', [{ id: 'missing-row', anchor: 'omega' }]),
    ).toThrow('exact patch "missing-row/main": missing anchor; expected exactly 1, found 0');
  });

  it('loud-fails a duplicate anchor with its patch id and cardinality', () => {
    expect(() =>
      inspectExactTextPatchAnchors('alpha alpha', [{ id: 'duplicate-row', anchor: 'alpha' }]),
    ).toThrow('exact patch "duplicate-row/main": duplicate anchor; expected exactly 1, found 2');
  });

  it('counts overlapping duplicates instead of accepting the first occurrence', () => {
    expect(() =>
      inspectExactTextPatchAnchors('aaaa', [{ id: 'overlapping-duplicate', anchor: 'aaa' }]),
    ).toThrow(
      'exact patch "overlapping-duplicate/main": duplicate anchor; expected exactly 1, found 2',
    );
  });

  it('loud-fails overlapping patch spans with both patch ids', () => {
    expect(() =>
      inspectExactTextPatchAnchors('abcde', [
        { id: 'left-row', anchor: 'bcd' },
        { id: 'right-row', anchor: 'cde' },
      ]),
    ).toThrow('exact patches "left-row/main" and "right-row/main": anchors overlap');
  });

  it('allows multiple named hunks owned by one semantic policy id', () => {
    expect(
      applyExactTextPatches('alpha beta', [
        { id: 'same-row', hunk: 'first', anchor: 'alpha', replacement: 'one' },
        { id: 'same-row', hunk: 'second', anchor: 'beta', replacement: 'two' },
      ]).output,
    ).toBe('one two');
  });

  it('loud-fails a duplicate semantic-id/hunk key before mutation', () => {
    expect(() =>
      inspectExactTextPatchAnchors('alpha beta', [
        { id: 'same-row', anchor: 'alpha' },
        { id: 'same-row', anchor: 'beta' },
      ]),
    ).toThrow('exact patch plan: duplicate patch key "same-row/main"');
  });
});

describe('esbuild-wasm 0.28.0 exact upstream patch anchors', () => {
  it('keeps the ratified patch ids in one exact order', () => {
    expect(ESBUILD_RUNTIME_PATCH_IDS).toEqual(RATIFIED_PATCH_IDS);
    expect([...new Set(ESBUILD_RUNTIME_PATCH_ANCHORS.map(({ id }) => id))]).toEqual(
      RATIFIED_PATCH_IDS,
    );
  });

  for (const patch of ESBUILD_RUNTIME_PATCH_ANCHORS) {
    it(`finds exactly one non-empty upstream anchor: ${patch.id}`, () => {
      const inspection = inspectExactTextPatchAnchors(upstreamBrowserCjs, [patch]);
      expect(inspection.sourceSha256).toBe(
        'b882a5ffb3bf170c0d8f40c0832cc5dca00830400314bb9455dea5d6f58c2a10',
      );
      expect(inspection.anchors).toEqual([
        {
          id: patch.id,
          hunk: patch.hunk ?? 'main',
          inputSpan: {
            start: upstreamBrowserCjs.indexOf(patch.anchor),
            end: upstreamBrowserCjs.indexOf(patch.anchor) + patch.anchor.length,
          },
          beforeSha256: sha256(patch.anchor),
        },
      ]);
    });
  }

  it('keeps all ratified upstream anchors non-overlapping', () => {
    const inspection = inspectExactTextPatchAnchors(
      upstreamBrowserCjs,
      ESBUILD_RUNTIME_PATCH_ANCHORS,
    );
    expect(inspection.anchors).toHaveLength(ESBUILD_RUNTIME_PATCH_ANCHORS.length);
  });
});
