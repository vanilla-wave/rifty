import { consumeKernelEntryCapabilityPorts } from '../../src/index.ts';

const capability = consumeKernelEntryCapabilityPorts()['browser.echo'];
if (capability === undefined) {
  throw new Error("missing URL-entry capability port 'browser.echo'");
}

const ambientCapabilityGlobalPresent = Object.getOwnPropertyNames(globalThis).includes(
  '__riftyKernelEntryCapabilityPorts__',
);

capability.addEventListener('message', (event) => {
  capability.postMessage({ kind: 'echo', payload: event.data });
});
capability.start();
capability.postMessage({ kind: 'ready', ambientCapabilityGlobalPresent });
