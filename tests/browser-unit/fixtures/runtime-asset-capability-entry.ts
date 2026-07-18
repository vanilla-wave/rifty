import { readKernelEntryCapabilityPorts } from '../../../packages/kernel/src/index.ts';

const capability = readKernelEntryCapabilityPorts()['rifty.shadow-assets.v1'];
if (capability === undefined) {
  throw new Error("missing URL-entry capability port 'rifty.shadow-assets.v1'");
}

capability.addEventListener('message', (event) => {
  capability.postMessage({ kind: 'echo', payload: event.data });
});
capability.start();
capability.postMessage({ kind: 'ready' });
