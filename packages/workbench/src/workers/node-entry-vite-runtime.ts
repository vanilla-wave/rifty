import { NotImplementedError } from '@riftydev/io';
import type { KernelEntryCapabilityPorts } from '@riftydev/kernel';
import {
  SHADOW_ASSET_CAPABILITY,
  type ShadowAssetPortClient,
  createBuiltinShadowAssetPortClient,
} from '@riftydev/npm-client';
import {
  type PlannedViteCliPreparation,
  type PlannedViteProgrammaticPreparation,
  type ViteCliPreparation,
  planViteCliPreparation,
  planViteProgrammaticPreparation,
  prepareViteCli,
  prepareViteProgrammaticApi,
} from './vite-cli-prep.ts';
import { closeUnusedWorkbenchEntryCapabilities } from './workbench-entry-capabilities.ts';

const VITE_ESBUILD_RUNTIME_BINDING = Object.freeze({
  runtimeAdapterId: 'rifty.runtime-adapter.esbuild-vite.v1',
  resolvedPublicVersion: '0.28.0',
});

async function runAndDispose(
  client: ShadowAssetPortClient,
  prepare: (client: ShadowAssetPortClient) => Promise<void>,
): Promise<void> {
  let preparationFailed = false;
  let preparationFailure: unknown;
  try {
    await prepare(client);
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

async function preparePlannedVite(
  plan: PlannedViteCliPreparation | PlannedViteProgrammaticPreparation,
  capabilities: KernelEntryCapabilityPorts,
  prepare: (shadowAssets?: ShadowAssetPortClient) => Promise<void>,
): Promise<void> {
  if (plan.runtimeDecision !== 'start') {
    if (Object.keys(capabilities).length !== 0) {
      failAfterCapabilityClose(
        capabilities,
        new Error('Vite without the esbuild runtime received an unexpected entry capability'),
      );
    }
    await prepare();
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
  await runAndDispose(client, () => prepare(client));
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
  await preparePlannedVite(plan, capabilities, (client) => prepareViteCli(plan, client));
}

/** Prepare direct `import('vite')` under the same admission and version gate. */
export async function prepareViteProgrammaticForNodeEntry(
  root: string,
  capabilities: KernelEntryCapabilityPorts,
  packageRoot?: string,
): Promise<void> {
  let plan: PlannedViteProgrammaticPreparation;
  try {
    plan = planViteProgrammaticPreparation(root, packageRoot);
  } catch (error) {
    failAfterCapabilityClose(capabilities, error);
  }
  await preparePlannedVite(plan, capabilities, (client) =>
    prepareViteProgrammaticApi(plan, client),
  );
}
