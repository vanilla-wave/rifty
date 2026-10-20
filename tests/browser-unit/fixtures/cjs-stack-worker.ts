/// <reference lib="webworker" />
import { createModuleLoader } from '../../../packages/runtime-js/src/module-loader/loader.ts';
import { MemoryFsSync } from '../../../packages/vfs/src/internal/index.ts';
const scope = globalThis as unknown as DedicatedWorkerGlobalScope;
scope.addEventListener(
  'message',
  (event: MessageEvent<{ entry: string; source: string; dep: string }>) => {
    try {
      const { entry, source, dep } = event.data;
      const fs = new MemoryFsSync();
      fs.loadFixture({ [entry]: source, [entry.replace('entry.cjs', 'dep.cjs')]: dep });
      scope.postMessage({ value: createModuleLoader(fs).require(entry) });
    } catch (error) {
      scope.postMessage({
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
    }
  },
);
