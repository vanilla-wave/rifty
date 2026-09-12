/// <reference lib="webworker" />
import { pauseCatalogPointer } from './opfs-catalog-pointer-boundary.ts';

// External native OPFS boundary only. All owner, npm and snapshot code is real.
const channel = new BroadcastChannel('pr323-interrupted-install');
let persistedBytes = 0;
pauseCatalogPointer('after-close', () => channel.postMessage({ persistedBytes }), {
  targetPath:
    '/pr323-interrupted/.rifty/workbench/v1/projects/saved-interrupted/tree/node_modules/lodash/LICENSE',
  afterNativeClose: async (handle) => {
    persistedBytes = (await handle.getFile()).size;
  },
})();
await import('../../../packages/workbench/src/workers/workbench-owner-bootstrap.ts');
