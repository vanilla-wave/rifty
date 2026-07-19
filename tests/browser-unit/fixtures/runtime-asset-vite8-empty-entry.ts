/// <reference lib="webworker" />

import { readKernelEntryCapabilityPorts } from '../../../packages/kernel/src/index.ts';
import { readNodeEntryBootstrap } from '../../../packages/runtime-js/src/builtins/node-entry-url.ts';
import { VITE_CONFIG_TEMP_CACHE_CAPABILITY } from '../../../packages/workbench/src/workers/vite-config-temp-cache-protocol.ts';

const capabilityKeys = Object.keys(readKernelEntryCapabilityPorts());
const launchKind = readNodeEntryBootstrap().launch.kind;
const expectedCapabilityKeys = launchKind === 'program' ? [VITE_CONFIG_TEMP_CACHE_CAPABILITY] : [];
if (JSON.stringify(capabilityKeys) !== JSON.stringify(expectedCapabilityKeys)) {
  throw new Error(
    `default Vite 8 ${launchKind} received capabilities: ${capabilityKeys.join(', ')}`,
  );
}

const childProcess = (
  globalThis as unknown as {
    readonly process?: { readonly stdout?: { write(chunk: string): unknown } };
  }
).process;
if (launchKind === 'program') {
  childProcess?.stdout?.write(`RIFTY_VITE8_CAPABILITY_KEYS:${JSON.stringify(capabilityKeys)}\n`);
}

await import('../../../packages/workbench/src/workers/node-entry-bootstrap.ts');
