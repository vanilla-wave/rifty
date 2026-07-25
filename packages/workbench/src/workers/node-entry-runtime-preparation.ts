import {
  type KernelEntryCapabilityPorts,
  consumeKernelEntryCapabilityPorts,
} from '@riftydev/kernel';
import {
  SHADOW_ASSET_PORT_CAPABILITY,
  createShadowAssetPortClient,
} from '@riftydev/npm-client/internal';
import type { FsSync } from '@riftydev/vfs';
import { planViteNodeEntryEdge as planNodeEntryIntegration } from './vite-node-entry-edge.ts';
import { activateWorkbenchRuntimeAdapters } from './workbench-runtime-adapters.ts';

function closeCapabilities(capabilities: KernelEntryCapabilityPorts): void {
  const failures: unknown[] = [];
  for (const port of Object.values(capabilities)) {
    try {
      port.close();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, 'Workbench entry capability close failed');
  }
}

function closeThenThrow(capabilities: KernelEntryCapabilityPorts, failure: unknown): never {
  try {
    closeCapabilities(capabilities);
  } catch (closeFailure) {
    throw new AggregateError(
      [failure, closeFailure],
      'Workbench entry capability rejection and close failed',
    );
  }
  throw failure;
}

function consumeWorkbenchCapabilities(): KernelEntryCapabilityPorts {
  const capabilities = consumeKernelEntryCapabilityPorts();
  const unknown = Object.keys(capabilities).filter((name) => name !== SHADOW_ASSET_PORT_CAPABILITY);
  if (unknown.length !== 0) {
    closeThenThrow(
      capabilities,
      new Error(`unsupported Workbench entry capabilities: ${unknown.join(', ')}`),
    );
  }
  return capabilities;
}

async function activateWorkbenchCapabilities(
  capabilities: KernelEntryCapabilityPorts,
  options: {
    readonly activateRuntimeAdapters: boolean;
    readonly fs: FsSync;
    readonly cwd: string;
  },
): Promise<void> {
  if (!options.activateRuntimeAdapters) {
    closeCapabilities(capabilities);
    return;
  }
  const shadowAssets = capabilities[SHADOW_ASSET_PORT_CAPABILITY];
  if (shadowAssets === undefined) return;
  const client = createShadowAssetPortClient(shadowAssets);
  await activateWorkbenchRuntimeAdapters({
    assets: client,
    fs: options.fs,
    cwd: options.cwd,
  });
}

/** Privileged generic entry preparation over strict ready bindings and adapter ids. */
export async function prepareNodeEntryRuntime(options: {
  readonly bin: boolean;
  readonly root: string;
  readonly args: readonly string[];
  readonly entryPath: string;
  readonly fs: FsSync;
}): Promise<void> {
  const capabilities = consumeWorkbenchCapabilities();
  let integration: ReturnType<typeof planNodeEntryIntegration>;
  try {
    integration = planNodeEntryIntegration(options);
  } catch (error) {
    closeThenThrow(capabilities, error);
  }

  await activateWorkbenchCapabilities(capabilities, {
    activateRuntimeAdapters: integration.activateRuntimeAdapters,
    fs: options.fs,
    cwd: options.root,
  });
  await integration.complete();
}
