import type { ParityCase } from '../../src/types.ts';

// ADR-0446: Node's Worker reference shape. Two own symbol-keyed objects hold
// the parent: Symbol(kHandle) (referenced from construction) and
// Symbol(kPublicPort) (referenced while the Worker has 'message' listeners,
// Node's setupPortReferencing). Worker#ref()/unref() call through both at call
// time. The program ends unreferenced, so the worker's late message and its
// 'exit' must never print: the parent exits first, as in Node.
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
    const symbols = Object.getOwnPropertySymbols(worker);
    const kHandle = symbols.find((s) => s.toString().includes('kHandle'));
    const kPublicPort = symbols.find((s) => s.toString().includes('kPublicPort'));
    console.log('symbols', String(kHandle), String(kPublicPort));
    const descriptor = (key) => {
      const d = Object.getOwnPropertyDescriptor(worker, key) ?? {};
      return [d.enumerable, d.writable, d.configurable].join('/');
    };
    console.log('descriptors', descriptor(kHandle), descriptor(kPublicPort));
    console.log(
      'methods',
      typeof worker.ref,
      typeof worker.unref,
      typeof worker.hasRef,
      Worker.prototype.ref.length,
      Worker.prototype.unref.length,
    );
    const flags = () => worker[kHandle]?.hasRef() + ',' + worker[kPublicPort]?.hasRef();
    console.log('initial', flags());
    const onMessage = (message) => console.log('message', message);
    worker.on('message', onMessage);
    console.log('listener', flags());
    console.log('unref', String(worker.unref()), flags());
    console.log('ref', String(worker.ref()), flags());
    worker.ref();
    worker.unref();
    console.log('double-ref-single-unref', flags());
    worker.on('message', onMessage);
    console.log('second-listener', flags());
    worker.removeAllListeners('message');
    console.log('remove-all', flags());
    worker.on('message', onMessage);
    console.log('relisten', flags());
    worker.off('message', onMessage);
    console.log('off', flags());
    worker.once('message', onMessage);
    console.log('once', flags());
    worker.removeListener('message', onMessage);
    console.log('removed-once', flags());
    worker.on('exit', (code) => console.log('exit', code));
  `,
  expected:
    'symbols Symbol(kHandle) Symbol(kPublicPort)\n' +
    'descriptors true/true/true true/true/true\n' +
    'methods function function undefined 0 0\n' +
    'initial true,false\n' +
    'listener true,true\n' +
    'unref undefined false,false\n' +
    'ref undefined true,true\n' +
    'double-ref-single-unref false,false\n' +
    'second-listener false,false\n' +
    'remove-all false,false\n' +
    'relisten false,true\n' +
    'off false,false\n' +
    'once false,true\n' +
    'removed-once false,false\n',
  kind: 'worker-env',
  expectedPhysicalWorkers: 1,
};

export default c;
