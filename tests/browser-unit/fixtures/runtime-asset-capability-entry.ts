import { readKernelEntryCapabilityPorts } from '../../../packages/kernel/src/index.ts';
import {
  SHADOW_ASSET_CAPABILITY,
  createShadowAssetPortClient,
  planBuiltinShadowAssets,
} from '../../../packages/npm-client/src/index.ts';
import { builtinShadowAssetCatalog } from '../../../tools/shadow-registry/src/index.ts';

const capabilities = readKernelEntryCapabilityPorts();
const capability = capabilities[SHADOW_ASSET_CAPABILITY];
if (capability === undefined) {
  throw new Error(`missing URL-entry capability port '${SHADOW_ASSET_CAPABILITY}'`);
}

const plan = planBuiltinShadowAssets([
  {
    catalog: {
      id: builtinShadowAssetCatalog.id,
      digest: builtinShadowAssetCatalog.digest,
    },
    publicName: 'esbuild',
    requestedRange: '^0.28.0',
    resolvedPublicVersion: '0.28.0',
    substitutionId: 'rifty.shadow-substitution.esbuild-synthesized-delegate.v2',
    runtimeAdapterId: 'rifty.runtime-adapter.esbuild-vite.v1',
    builtin: true,
  },
]);
const asset = plan.assets[0];
if (asset === undefined) throw new Error('runtime-asset fixture expected one planned asset');

const forkProcess = (
  globalThis as unknown as {
    process?: { send?: (message: unknown) => unknown };
  }
).process;
if (typeof forkProcess?.send !== 'function') {
  throw new Error('runtime-asset fixture requires child fork IPC');
}

const client = createShadowAssetPortClient({ port: capability, plan });
void client.readVerified(asset.id, { deadlineMs: 30_000 }).catch(() => {});
forkProcess.send({
  kind: 'runtime-asset-capability-ready',
  assetId: asset.id,
  capabilityKeys: Object.keys(capabilities),
});
forkProcess.send({ type: 'rifty:node-listening', ports: [43142] });
