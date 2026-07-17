import type { ParityCase } from '../../src/types.ts';

// Node's parent-side Worker is an EventEmitter, not a DOM Worker. Browser-shaped
// callback names may be assigned as ordinary expandos, but Node never invokes
// them. @emnapi/wasi-threads relies on that distinction when it bridges the
// EventEmitter event into its own browser-shaped handler.
const c: ParityCase = {
  setup: {
    files: {
      'worker.mjs':
        'import { parentPort } from "node:worker_threads";\nparentPort.postMessage("ready");\n',
    },
  },
  code: `
    const { Worker } = require('node:worker_threads');
    const { resolve } = require('node:path');
    const originalWarn = console.warn;
    console.warn = () => {};
    const worker = new Worker(resolve('worker.mjs'));
    const keepalive = setInterval(() => {}, 10);
    worker.on('error', (error) => {
      clearInterval(keepalive);
      console.warn = originalWarn;
      throw error;
    });
    worker.on('exit', () => {
      clearInterval(keepalive);
      console.warn = originalWarn;
    });
    console.log('onmessage' in worker, 'onerror' in worker);
    worker.onmessage = () => {};
    worker.onerror = () => {};
    console.log('assigned', typeof worker.onmessage, typeof worker.onerror);
  `,
  expected: 'false false\nassigned function function\n',
};

export default c;
