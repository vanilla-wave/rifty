import type { ParityCase } from '../../src/types.ts';

// ADR-0446: rolldown's wasm32-wasi pool Workers must never hold vite/vitest.
// napi-rs neuters Worker#ref() by replacing `ref` on the Worker's own
// Symbol(kPublicPort)/Symbol(kHandle) objects, then unrefs; emnapi later adds
// 'message' listeners and calls ref(). Verbatim sources:
// @rolldown/binding-wasm32-wasi@1.0.3 rolldown-binding.wasi.cjs:64-90
// (onCreateWorker); @emnapi/wasi-threads@1.2.1 wasi-threads.cjs.js:167-169
// (preparePool), :183 (loadWasmModuleToAllWorkers), :287-297
// (loadWasmModuleToWorker). In Node nothing holds the parent afterwards, so the
// worker's late message and 'exit' never print.
const c: ParityCase = {
  setup: {
    files: {
      'w-late.cjs':
        "const { parentPort } = require('node:worker_threads');\n" +
        "setTimeout(() => parentPort.postMessage('late'), 300);\n",
    },
  },
  code: `
    const { Worker } = require('node:worker_threads');
    const { resolve } = require('node:path');
    const worker = new Worker(resolve('w-late.cjs'));
    // rolldown-binding.wasi.cjs:73-90, verbatim
    {
      const kPublicPort = Object.getOwnPropertySymbols(worker).find(s =>
        s.toString().includes("kPublicPort")
      );
      if (kPublicPort) {
        worker[kPublicPort].ref = () => {};
      }

      const kHandle = Object.getOwnPropertySymbols(worker).find(s =>
        s.toString().includes("kHandle")
      );
      if (kHandle) {
        worker[kHandle].ref = () => {};
      }

      worker.unref();
    }
    // wasi-threads.cjs.js:168-169 (preparePool)
    worker.once('message', () => { });
    worker.unref();
    // wasi-threads.cjs.js:183 (loadWasmModuleToAllWorkers)
    worker.ref();
    // wasi-threads.cjs.js:287-297 (loadWasmModuleToWorker)
    worker.on('message', function (data) {
      console.log('message', data);
    });
    worker.on('error', function (e) {
      console.log('error', e && e.message);
    });
    worker.on('detachedExit', function () { });
    worker.on('exit', (code) => console.log('exit', code));
    const symbols = Object.getOwnPropertySymbols(worker);
    const kHandle = symbols.find((s) => s.toString().includes('kHandle'));
    const kPublicPort = symbols.find((s) => s.toString().includes('kPublicPort'));
    console.log(
      'neutered',
      kHandle !== undefined && worker[kHandle].hasRef(),
      kPublicPort !== undefined && worker[kPublicPort].hasRef(),
      Object.hasOwn(worker[kHandle] ?? {}, 'ref'),
      Object.hasOwn(worker[kPublicPort] ?? {}, 'ref'),
    );
  `,
  expected: 'neutered false false true true\n',
  kind: 'worker-env',
  expectedPhysicalWorkers: 1,
};

export default c;
