import { NotImplementedError } from '@riftydev/io';
import type { KernelEntryCapabilityPorts } from '@riftydev/kernel';
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
import { closeUnusedWorkbenchEntryCapabilities } from './workbench-entry-capabilities.ts';

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

function failAfterCapabilityClose(
  capabilities: KernelEntryCapabilityPorts,
  failure: unknown,
): never {
  try {
    closeUnusedWorkbenchEntryCapabilities(capabilities);
  } catch (closeFailure) {
    throw new AggregateError(
      [failure, closeFailure],
      'Vite preparation planning and capability close failed',
    );
  }
  throw failure;
}

/** Prepare one Node-entry Vite CLI after privileged capability consumption. */
export async function prepareViteCliForNodeEntry(
  preparation: ViteCliPreparation,
  capabilities: KernelEntryCapabilityPorts,
): Promise<void> {
  let plan: PlannedViteCliPreparation;
  try {
    plan = planViteCliPreparation(preparation);
  } catch (error) {
    failAfterCapabilityClose(capabilities, error);
  }
  if (plan.runtimeDecision !== 'start') {
    if (Object.keys(capabilities).length !== 0) {
      failAfterCapabilityClose(
        capabilities,
        new Error('Vite without the esbuild runtime received an unexpected entry capability'),
      );
    }
    await prepareViteCli(plan);
    return;
  }

  const port = capabilities[SHADOW_ASSET_CAPABILITY];
  if (port === undefined) {
    throw new NotImplementedError('vite.esbuild.shadowAssets');
  }
  const client = createBuiltinShadowAssetPortClient({
    port,
    binding: VITE_ESBUILD_RUNTIME_BINDING,
  });
  await prepareAndDispose(plan, client);
}
