/// <reference lib="webworker" />

import { readKernelEntryCapabilityPorts } from '../../../packages/kernel/src/index.ts';

const capabilityKeys = Object.keys(readKernelEntryCapabilityPorts());
if (capabilityKeys.length !== 0) {
  throw new Error(`default Vite 8 received capabilities: ${capabilityKeys.join(', ')}`);
}

const childProcess = (
  globalThis as unknown as {
    readonly process?: { readonly stdout?: { write(chunk: string): unknown } };
  }
).process;
childProcess?.stdout?.write(`RIFTY_VITE8_CAPABILITY_KEYS:${JSON.stringify(capabilityKeys)}\n`);

await import('../../../packages/workbench/src/workers/node-entry-bootstrap.ts');
