import { trackKeepalivePromise } from '@riftydev/runtime-js';
import { preparePackageEntryRuntime } from '@riftydev/shadow-registry/runtime';
export async function prepareNodeEntryRuntime(
  options: Parameters<typeof preparePackageEntryRuntime>[0],
): Promise<void> {
  await preparePackageEntryRuntime({ ...options, trackKeepalivePromise });
}
