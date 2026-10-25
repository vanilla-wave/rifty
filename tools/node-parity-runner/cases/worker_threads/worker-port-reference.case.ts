import type { ParityCase } from '../../src/types.ts';

// ADR-0446: inside a worker, `parentPort` is a MessagePort-shaped reference.
// The first 'message' listener (on/once/onmessage) references it; removing the
// last one with off/removeListener (or a once() firing, or `onmessage = null`)
// unreferences it; removeAllListeners() leaves it as it is; `ref()`/`unref()`
// set it directly. An unreferenced port lets the worker's loop drain: 'exit' 0
// with no terminate(). Held ports: worker-port-held.case.ts. The Workers run
// at once; rows print after the last 'exit', so only live Workers hold the parent.
const port = "const { parentPort } = require('node:worker_threads');\n";
const c: ParityCase = {
  setup: {
    files: {
      'w-shape.cjs': `${port}const rows = [];
const on = () => {};
rows.push('initial=' + parentPort.hasRef());
parentPort.on('message', on);
rows.push('on=' + parentPort.hasRef());
parentPort.unref();
rows.push('unref=' + parentPort.hasRef());
parentPort.ref();
rows.push('ref=' + parentPort.hasRef());
parentPort.off('message', on);
rows.push('off=' + parentPort.hasRef());
parentPort.onmessage = () => {};
rows.push('onmessage=' + parentPort.hasRef());
parentPort.onmessage = null;
rows.push('onmessage-null=' + parentPort.hasRef());
parentPort.on('message', on);
parentPort.removeAllListeners('message');
rows.push('remove-all=' + parentPort.hasRef());
parentPort.unref();
parentPort.once('message', on);
rows.push('once=' + parentPort.hasRef());
parentPort.removeListener('message', on);
rows.push('once-removed=' + parentPort.hasRef());
rows.push('returns=' + typeof parentPort.ref() + ',' + typeof parentPort.unref());
parentPort.postMessage(rows.join(' '));
`,
      'w-once.cjs': `${port}parentPort.once('message', (message) => parentPort.postMessage('echo:' + message));\n`,
      'w-off.cjs': `${port}const on = (message) => { parentPort.postMessage('echo:' + message); parentPort.off('message', on); };
parentPort.on('message', on);
`,
      'w-unref.cjs': `${port}parentPort.on('message', (message) => parentPort.postMessage('echo:' + message));
parentPort.unref();
parentPort.postMessage('ready');
`,
    },
  },
  code: `
    const { Worker } = require('node:worker_threads');
    const { resolve } = require('node:path');
    const run = (file, post) =>
      new Promise((done) => {
        const worker = new Worker(resolve(file));
        const rows = [];
        worker.on('message', (message) => rows.push('message:' + message));
        worker.on('online', () => {
          if (post !== undefined) worker.postMessage(post);
        });
        worker.on('exit', (code) => {
          rows.push('exit:' + code);
          done(file + ' ' + rows.join(' '));
        });
      });
    Promise.all([
      run('w-shape.cjs'),
      run('w-once.cjs', 'a'),
      run('w-off.cjs', 'a'),
      run('w-unref.cjs'),
    ]).then((rows) => console.log(rows.join('\\n')));
  `,
  expected:
    'w-shape.cjs message:initial=false on=true unref=false ref=true off=false onmessage=true ' +
    'onmessage-null=false remove-all=true once=true once-removed=false returns=undefined,undefined exit:0\n' +
    'w-once.cjs message:echo:a exit:0\n' +
    'w-off.cjs message:echo:a exit:0\n' +
    'w-unref.cjs message:ready exit:0\n',
  kind: 'worker-env',
  expectedPhysicalWorkers: 4,
};

export default c;
