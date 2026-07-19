import {
  KERNEL_ENTRY_CAPABILITY_PORTS_KEY,
  consumeKernelEntryCapabilityPorts,
} from '../../src/index.ts';

const capability = consumeKernelEntryCapabilityPorts()['browser.echo'];
if (capability === undefined) {
  throw new Error("missing URL-entry capability port 'browser.echo'");
}
const ambientCapabilityGlobalPresent = Object.getOwnPropertyNames(globalThis).includes(
  KERNEL_ENTRY_CAPABILITY_PORTS_KEY,
);

capability.addEventListener('message', (event) => {
  capability.postMessage({ kind: 'echo', payload: event.data });
});
capability.start();
capability.postMessage({ kind: 'ready', ambientCapabilityGlobalPresent });
