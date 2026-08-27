import { runChildFsInRealmLane } from './child-fs-in-realm-lane.ts';
import { runChildFsProductLane } from './child-fs-product-lane.ts';
import {
  closeSealedWorkbenchFixture,
  currentProject,
  executeProjectLineOutcome,
  openSealedWorkbenchFixture,
  writeProjectText,
} from './sealed-playground-workbench.ts';

function inRealmHost() {
  return {
    open(url: string) {
      return new Worker(url, { type: 'module' });
    },
  };
}

function productHost() {
  return {
    coi: globalThis.crossOriginIsolated === true,
    open: (plan: unknown) =>
      openSealedWorkbenchFixture({
        workspaceId: 'child-fs-orchestrator',
        persistence: 'ephemeral',
        plan,
      }),
    writeText: (path: string, contents: string) => writeProjectText(`/scratch${path}`, contents),
    execute: (line: string) => executeProjectLineOutcome(line),
    readdir: (path: string) => currentProject().files.readdir(path),
    async readText(path: string) {
      const read = await currentProject().files.readFile(path);
      return new TextDecoder().decode(read.bytes);
    },
    close: () => closeSealedWorkbenchFixture(),
  };
}

export async function runChildFsBrowserSample(lane: 'in-realm' | 'product-coi', ordinal: number) {
  if (globalThis.crossOriginIsolated !== true) {
    throw new Error('child fs browser orchestrator requires cross-origin isolation');
  }
  return lane === 'product-coi'
    ? (await runChildFsProductLane(ordinal, productHost())).sample
    : (await runChildFsInRealmLane(ordinal, inRealmHost())).sample;
}
