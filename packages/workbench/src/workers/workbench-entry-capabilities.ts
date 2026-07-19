import {
  type KernelEntryCapabilityPorts,
  consumeKernelEntryCapabilityPorts,
} from '@riftydev/kernel';
import { SHADOW_ASSET_CAPABILITY } from '@riftydev/npm-client';

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

function closeThenThrow(capabilities: KernelEntryCapabilityPorts, failure: Error): never {
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

/** Consume the kernel publication and admit only Workbench-owned protocols. */
export function consumeWorkbenchEntryCapabilities(): KernelEntryCapabilityPorts {
  const capabilities = consumeKernelEntryCapabilityPorts();
  const unknown = Object.keys(capabilities).filter((name) => name !== SHADOW_ASSET_CAPABILITY);
  if (unknown.length !== 0) {
    closeThenThrow(
      capabilities,
      new Error(`unsupported Workbench entry capabilities: ${unknown.join(', ')}`),
    );
  }
  return capabilities;
}

/** Settle an admitted capability set that this entry will not use. */
export function closeUnusedWorkbenchEntryCapabilities(
  capabilities: KernelEntryCapabilityPorts,
): void {
  closeCapabilities(capabilities);
}
