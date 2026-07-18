import { NotImplementedError } from '@riftydev/io';
import { builtinShadowAssetCatalog } from '@riftydev/shadow-registry';
import { describe, expect, it } from 'vitest';
import {
  type AppliedShadowSubstitution,
  EMPTY_SHADOW_ASSET_PLAN,
  planBuiltinShadowAssets,
} from './shadow-asset-plan.ts';

function applied(overrides: Partial<AppliedShadowSubstitution> = {}): AppliedShadowSubstitution {
  return {
    catalog: { id: builtinShadowAssetCatalog.id, digest: builtinShadowAssetCatalog.digest },
    publicName: 'esbuild',
    requestedRange: '^0.28.0',
    resolvedPublicVersion: '0.28.0',
    substitutionId: 'rifty.shadow-substitution.esbuild-wasi-preview1.v1',
    runtimeAdapterId: 'rifty.runtime-adapter.esbuild-vite.v1',
    builtin: true,
    ...overrides,
  };
}

describe('builtin shadow-asset planner', () => {
  it('returns one canonical deeply frozen plan from exact applied value facts', () => {
    const first = planBuiltinShadowAssets([applied(), applied()]);
    const second = planBuiltinShadowAssets([
      applied({ requestedRange: '^0.28.0' }),
      applied({ requestedRange: '^0.28.0' }),
    ]);
    expect(first).toEqual(second);
    expect(first.assets).toEqual(builtinShadowAssetCatalog.assets);
    expect(first.substitutions).toEqual([applied()]);
    expect(first.requiredSetDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.substitutions[0]?.catalog)).toBe(true);
    expect(Object.isFrozen(first.assets[0]?.source)).toBe(true);
  });

  it('has one canonical empty plan and no reporter or ordering input', () => {
    expect(planBuiltinShadowAssets([])).toBe(EMPTY_SHADOW_ASSET_PLAN);
    expect(planBuiltinShadowAssets([])).toEqual({
      requiredSetDigest: EMPTY_SHADOW_ASSET_PLAN.requiredSetDigest,
      substitutions: [],
      assets: [],
    });
  });

  it('loud-throws an admitted substitution without an exact public-version map', () => {
    expect(() =>
      planBuiltinShadowAssets([applied({ resolvedPublicVersion: '0.29.0' })]),
    ).toThrowError(NotImplementedError);
    expect(() => planBuiltinShadowAssets([applied({ resolvedPublicVersion: '0.29.0' })])).toThrow(
      /shadow-registry\.esbuild@0\.29\.0\.assets/,
    );
  });

  it('rejects catalog and provenance drift rather than inferring from installed names', () => {
    expect(() => planBuiltinShadowAssets([applied({ builtin: false })])).toThrow();
    expect(() =>
      planBuiltinShadowAssets([applied({ catalog: { id: 'other', digest: '0'.repeat(64) } })]),
    ).toThrow();
    expect(() =>
      planBuiltinShadowAssets([
        applied({ substitutionId: 'rifty.shadow-substitution.unrelated.v1' }),
      ]),
    ).toThrow();
  });
});
