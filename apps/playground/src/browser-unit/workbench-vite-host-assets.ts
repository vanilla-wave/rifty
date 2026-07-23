import devServerWorkerUrl from '@riftydev/workbench/dev-server-worker?worker&url';
import kernelWorkerUrl from '@riftydev/workbench/kernel-worker?worker&url';
import nodeWorkerUrl from '@riftydev/workbench/node-worker?worker&url';
import ownerWorkerUrl from '@riftydev/workbench/owner-worker?worker&url';
import typescriptWorkerUrl from '@riftydev/workbench/typescript-worker?worker&url';
import esbuildWasmUrl from 'esbuild-wasm/esbuild.wasm?url';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

/** Browser-unit host composition only; Workbench remains bundler-query-free. */
export const workbenchViteHostAssets = Object.freeze({
  workers: Object.freeze({
    owner: ownerWorkerUrl,
    kernel: kernelWorkerUrl,
    node: nodeWorkerUrl,
    devServer: devServerWorkerUrl,
    typescript: typescriptWorkerUrl,
  }),
  wasm: Object.freeze({
    sqlite: sqlWasmUrl,
    esbuild: esbuildWasmUrl,
  }),
});
