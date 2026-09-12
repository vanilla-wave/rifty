import {
  type PlaygroundWorkbench,
  openPlaygroundWorkbench,
} from '../../../apps/playground/src/browser-unit/workbench-playground-entry.ts';
import type { RetainedCatalog } from './orphan-scratch-recovery-data.ts';
export { nativeTree, seedNativeOrphan } from './orphan-scratch-recovery-data.ts';

let active: PlaygroundWorkbench | undefined;
let base: HTMLBaseElement | undefined;
function workbench(): PlaygroundWorkbench {
  if (active === undefined) throw new Error('Orphan public Workbench is not open');
  return active;
}

export async function open(namespace: string): Promise<void> {
  const assetsUrl = '/src/browser-unit/workbench-vite-host-assets.ts';
  const { workbenchViteHostAssets: assets } = await import(/* @vite-ignore */ assetsUrl);
  const owner = new URL(assets.workers.owner, location.href);
  base = document.createElement('base');
  base.href = new URL('.', owner).href;
  document.head.prepend(base);
  try {
    active = await openPlaygroundWorkbench({
      deployment: {
        workers: { ...assets.workers, owner: owner.href },
        serviceWorker: { url: '/sw.js', scope: '/' },
        wasm: assets.wasm,
        previewProbeTimeoutMs: 30_000,
      },
      packageAcquisition: { registryUrl: '/npm-registry' },
      storage: { persistence: 'required', namespace },
    });
  } catch (error) {
    base.remove();
    base = undefined;
    throw error;
  }
}

export async function createFresh(): Promise<{ marker: string; originalPresent: boolean }> {
  const owner = workbench();
  const definition = owner.playground.define({
    kind: 'node-cli',
    id: 'scratch',
    starterId: 'orphan-fresh',
    templateId: 'orphan-fresh',
    entryPath: '/main.cjs',
    files: {
      '/package.json': '{"name":"orphan-fresh","private":true}',
      '/main.cjs': 'console.log("fresh");\n',
      '/fresh.txt': 'fresh Scratch\n',
    },
    firstMaterialization: { kind: 'install' },
  });
  await owner.playground.catalog.createScratch({ definition });
  const project = await owner.openProject(definition);
  try {
    return {
      marker: new TextDecoder().decode((await project.files.readFile('/fresh.txt')).bytes),
      originalPresent: (await project.files.readdir('/')).some(
        (entry) => entry.path === '/user.bin',
      ),
    };
  } finally {
    await project.close();
  }
}

// Erased bridge only; absent baseline API still executes and rejects as a real TypeError.
function retained(): RetainedCatalog {
  return workbench().playground.catalog as unknown as RetainedCatalog;
}
export function list() {
  return retained().listRetainedScratch();
}
export function download(id: string) {
  return retained().exportRetainedScratch(id);
}
export async function close(): Promise<void> {
  try {
    await active?.close();
  } finally {
    active = undefined;
    base?.remove();
    base = undefined;
  }
}
