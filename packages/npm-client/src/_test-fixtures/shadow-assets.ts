import { canonicalShadowDigest } from '../canonical-shadow-json.ts';
import type {
  ShadowAssetEnsureResult,
  ShadowAssetInstaller,
  ShadowAssetPlan,
} from '../shadow-assets.ts';

function ready(plan: ShadowAssetPlan): ShadowAssetEnsureResult {
  if (plan.assets.length === 0) return { kind: 'not-required', plan };
  const catalog = plan.substitutions[0]?.catalog;
  if (!catalog) throw new Error('test shadow asset installer: non-empty plan has no catalog');
  const payload = {
    schema: 1 as const,
    requiredSetDigest: plan.requiredSetDigest,
    catalog,
    storageClass: 'memory-session' as const,
    substitutions: plan.substitutions,
    assets: plan.assets.map((asset) => ({
      id: asset.id,
      source: asset.source,
      member: asset.member,
      memberSha256: asset.memberSha256,
      memberSize: asset.memberSize,
      fillTransport: 'standard' as const,
      fillCache: 'network' as const,
    })),
  };
  return {
    kind: 'ready',
    plan,
    receipt: {
      ...payload,
      receiptSha256: canonicalShadowDigest(payload),
    },
  };
}

/** External readiness boundary for installer-only tests; manager has its own real/fault suite. */
export const readyShadowAssetInstaller: ShadowAssetInstaller = Object.freeze({
  ensure: async (plan: ShadowAssetPlan) => ready(plan),
  inspectReceipt: async () => null,
});
