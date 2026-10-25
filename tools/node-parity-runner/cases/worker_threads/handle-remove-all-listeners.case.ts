import type { ParityCase } from '../../src/types.ts';

// ADR-0446: Node's removeAllListeners emits 'removeListener' for every dropped
// 'message' listener, so the Worker's referencing listener unrefs
// Symbol(kPublicPort). With no argument it also drops that referencing
// listener: a later 'message' listener references nothing. Both Workers end
// unreferenced, so their late messages never print: the parent exits first.
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
    const flags = (worker) => {
      const symbols = Object.getOwnPropertySymbols(worker);
      const key = (name) => symbols.find((s) => s.toString().includes(name));
      return worker[key('kHandle')].hasRef() + ',' + worker[key('kPublicPort')].hasRef();
    };
    const first = new Worker(resolve('w-late.cjs'));
    first.unref();
    first.on('message', (message) => console.log('first message', message));
    first.on('message', (message) => console.log('first message again', message));
    console.log('first listeners', flags(first));
    first.removeAllListeners('message');
    console.log('first remove-all-message', flags(first));
    const second = new Worker(resolve('w-late.cjs'));
    second.on('message', (message) => console.log('second message', message));
    console.log('second listener', flags(second));
    second.removeAllListeners();
    console.log('second remove-all', flags(second));
    second.unref();
    second.on('message', (message) => console.log('second message late', message));
    console.log('second relisten', flags(second));
  `,
  expected:
    'first listeners false,true\n' +
    'first remove-all-message false,false\n' +
    'second listener true,true\n' +
    'second remove-all true,false\n' +
    'second relisten false,false\n',
  kind: 'worker-env',
  expectedPhysicalWorkers: 2,
};

export default c;
