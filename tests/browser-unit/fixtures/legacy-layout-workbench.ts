import {
  type PlaygroundWorkbench,
  openPlaygroundWorkbench,
} from '../../../apps/playground/src/browser-unit/workbench-playground-entry.ts';
import type { ProjectSession } from '../../../apps/playground/src/browser-unit/workbench-public-entry.ts';
let workbench: PlaygroundWorkbench | undefined;
let project: ProjectSession<unknown> | undefined;
export async function boot(
  namespace?: string,
  owner?: string,
  persistence: 'required' | 'preferred' | 'ephemeral' = 'required',
) {
  const url = '/src/browser-unit/workbench-vite-host-assets.ts';
  const { workbenchViteHostAssets: assets } = await import(/* @vite-ignore */ url);
  workbench = await openPlaygroundWorkbench({
    deployment: {
      workers: { ...assets.workers, ...(owner ? { owner } : {}) },
      serviceWorker: { url: '/sw.js', scope: '/' },
      wasm: assets.wasm,
    },
    packageAcquisition: { registryUrl: '/npm-registry' },
    storage: { persistence, ...(namespace === undefined ? {} : { namespace }) },
  });
  return inspect();
}
export function inspect() {
  if (!workbench) throw Error('Not open');
  return { health: workbench.health.snapshot(), catalog: workbench.playground.catalog.snapshot() };
}
export async function materialize() {
  if (!workbench) throw Error('Not open');
  const definition = workbench.playground.define({
    kind: 'node-cli',
    id: 'scratch',
    starterId: 'legacy-layout-proof',
    templateId: 'legacy-layout-proof',
    entryPath: '/main.cjs',
    firstMaterialization: { kind: 'install' },
    files: {
      '/package.json': '{"name":"legacy-layout-proof","version":"1.0.0","dependencies":{}}',
      '/main.cjs': 'console.log("NEW_DEFINITION")',
      '/source.txt': 'new definition',
    },
  });
  await workbench.playground.catalog.createScratch({ definition });
  project = await workbench.openProject(definition);
  const source = await project.files.readFile('/source.txt');
  let oldExists = true;
  try {
    await project.files.readFile('/old-edit.txt');
  } catch {
    oldExists = false;
  }
  return { source: new TextDecoder().decode(source.bytes), oldExists, ...inspect() };
}
export async function close() {
  if (project) {
    await project.close();
    project = undefined;
  }
  if (workbench) {
    await workbench.close();
    workbench = undefined;
  }
}
export function health() {
  if (!workbench) throw Error('Not open');
  return workbench.health;
}

export async function closeProject() {
  if (project) {
    await project.close();
    project = undefined;
  }
}
