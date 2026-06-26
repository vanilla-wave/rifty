export { Wasi, WasiExit, runWasi, type WasiOptions } from './wasi.ts';
export {
  createWasiProcess,
  getWasiWorkerUrl,
  setWasiWorkerUrl,
  type WasiProcessOpts,
} from './process-handle.ts';
export { WASI_PREOPENS_ENV, WASI_WASM_URL_ENV } from './wasi-channel-env.ts';
// NOTE: `runWasiInWorker` + the side-effectful `worker-entry` are intentionally
// NOT re-exported here — they live on the `@riftydev/runtime-wasi/worker-entry`
// subpath (the wasi worker bundle). Re-exporting them pulled `worker-entry`'s
// top-level guest-run into every runtime-js worker's `node:wasi` graph.
