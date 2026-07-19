import { NotImplementedError } from '@riftydev/io';
import { readKernelEntryCapabilityPorts } from '@riftydev/kernel';
import {
  SHADOW_ASSET_CAPABILITY,
  type ShadowAssetPortClient,
  createBuiltinShadowAssetPortClient,
} from '@riftydev/npm-client';
import {
  type PlannedViteCliPreparation,
  type ViteCliPreparation,
  planViteCliPreparation,
  prepareViteCli,
} from './vite-cli-prep.ts';

const VITE_ESBUILD_RUNTIME_BINDING = Object.freeze({
  runtimeAdapterId: 'rifty.runtime-adapter.esbuild-vite.v1',
  resolvedPublicVersion: '0.28.0',
});

async function prepareAndDispose(
  plan: PlannedViteCliPreparation,
  client: ShadowAssetPortClient,
): Promise<void> {
  let preparationFailed = false;
  let preparationFailure: unknown;
  try {
    await prepareViteCli(plan, client);
  } catch (error) {
    preparationFailed = true;
    preparationFailure = error;
  }

  let disposalFailed = false;
  let disposalFailure: unknown;
  try {
    await client.dispose();
  } catch (error) {
    disposalFailed = true;
    disposalFailure = error;
  }

  if (preparationFailed && disposalFailed) {
    throw new AggregateError(
      [preparationFailure, disposalFailure],
      'Vite shadow asset preparation and client disposal failed',
    );
  }
  if (preparationFailed) throw preparationFailure;
  if (disposalFailed) throw disposalFailure;
}

/** Prepare one Node-entry Vite CLI before its entry import. */
export async function prepareViteCliForNodeEntry(preparation: ViteCliPreparation): Promise<void> {
  const plan = planViteCliPreparation(preparation);
  if (plan.runtimeDecision !== 'start') {
    await prepareViteCli(plan);
    return;
  }

  const port = readKernelEntryCapabilityPorts()[SHADOW_ASSET_CAPABILITY];
  if (port === undefined) {
    throw new NotImplementedError('vite.esbuild.shadowAssets');
  }
  const client = createBuiltinShadowAssetPortClient({
    port,
    binding: VITE_ESBUILD_RUNTIME_BINDING,
  });
  await prepareAndDispose(plan, client);
}
