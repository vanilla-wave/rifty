import { readKernelEntryCapabilityPorts } from '../../src/index.ts';

const capability = readKernelEntryCapabilityPorts()['browser.echo'];
if (capability === undefined) {
  throw new Error("missing URL-entry capability port 'browser.echo'");
}

capability.addEventListener('message', (event) => {
  capability.postMessage({ kind: 'echo', payload: event.data });
});
capability.start();
capability.postMessage({ kind: 'ready' });
