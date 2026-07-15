import esbuildWasmUrl from 'esbuild-wasm/esbuild.wasm?url';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import devServerWorkerUrl from '../workers/dev-server-child-bootstrap.ts?worker&url';
import kernelWorkerUrl from '../workers/kernel-worker-entry.ts?worker&url';
import nodeWorkerUrl from '../workers/node-entry-bootstrap.ts?worker&url';
import ownerWorkerUrl from '../workers/real-vite-bootstrap.ts?worker&url';

/** Browser-unit host composition only; Workbench remains bundler-query-free. */
export const workbenchViteHostAssets = Object.freeze({
  workers: Object.freeze({
    owner: ownerWorkerUrl,
    kernel: kernelWorkerUrl,
    node: nodeWorkerUrl,
    devServer: devServerWorkerUrl,
  }),
  wasm: Object.freeze({
    sqlite: sqlWasmUrl,
    esbuild: esbuildWasmUrl,
  }),
});
