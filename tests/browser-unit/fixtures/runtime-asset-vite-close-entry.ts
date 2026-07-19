/// <reference lib="webworker" />

import { readKernelEntryCapabilityPorts } from '../../../packages/kernel/src/index.ts';
import { SHADOW_ASSET_CAPABILITY } from '../../../packages/npm-client/src/index.ts';

const capability = readKernelEntryCapabilityPorts()[SHADOW_ASSET_CAPABILITY];
if (capability === undefined) {
  throw new Error(`fault fixture missing '${SHADOW_ASSET_CAPABILITY}'`);
}

const nativePostMessage = capability.postMessage.bind(capability);
Object.defineProperty(capability, 'postMessage', {
  configurable: true,
  value(message: unknown, transferOrOptions?: StructuredSerializeOptions | Transferable[]): void {
    if (transferOrOptions === undefined) nativePostMessage(message);
    else if (Array.isArray(transferOrOptions)) {
      nativePostMessage(message, transferOrOptions as Transferable[]);
    } else nativePostMessage(message, transferOrOptions);
    if (
      typeof message === 'object' &&
      message !== null &&
      'protocol' in message &&
      message.protocol === 'rifty.shadow-assets/v1' &&
      'type' in message &&
      message.type === 'read'
    ) {
      queueMicrotask(() => capability.close());
    }
  },
});

await import('../../../packages/workbench/src/workers/node-entry-bootstrap.ts');
