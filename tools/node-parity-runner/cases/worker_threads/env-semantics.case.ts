import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  setup: {
    files: {
      'worker-env-child.mjs': `
        import { parentPort } from 'node:worker_threads';

        const hostKey = 'RIFTY_PARITY_HOST_BOOTSTRAP';
        parentPort.postMessage({
          parent: process.env.PARENT_ONLY ?? null,
          explicit: process.env.EXPLICIT_ONLY ?? null,
          replaced: process.env.REPLACED ?? null,
          hostOwn: Object.hasOwn(process.env, hostKey),
          hostValue: process.env[hostKey] ?? null,
        });
      `,
    },
  },
  code: `
    const { Worker } = require('node:worker_threads');
    const { resolve } = require('node:path');

    const previous = {
      parent: process.env.PARENT_ONLY,
      replaced: process.env.REPLACED,
      explicit: process.env.EXPLICIT_ONLY,
      host: process.env.RIFTY_PARITY_HOST_BOOTSTRAP,
    };
    process.env.PARENT_ONLY = 'parent';
    process.env.REPLACED = 'parent';
    delete process.env.EXPLICIT_ONLY;
    delete process.env.RIFTY_PARITY_HOST_BOOTSTRAP;

    function restore(key, value) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }

    function run(env) {
      return new Promise((resolveMessage, reject) => {
        const worker = new Worker(
          resolve('worker-env-child.mjs'),
          env === undefined ? {} : { env },
        );
        let received = false;
        worker.once('message', (message) => {
          received = true;
          Promise.resolve(worker.terminate()).then(() => resolveMessage(message), reject);
        });
        worker.once('error', reject);
        worker.once('messageerror', reject);
        worker.once('stderr', (chunk) => reject(new Error('worker stderr: ' + String(chunk))));
        worker.once('exit', (code) => {
          if (!received) reject(new Error('worker exited before env message: ' + code));
        });
      });
    }

    const keepalive = setInterval(() => {}, 10);
    (async () => {
      const inherited = await run();
      const replaced = await run({
        EXPLICIT_ONLY: 'explicit',
        RIFTY_PARITY_HOST_BOOTSTRAP: 'guest-visible',
      });
      console.log('inherited ' + JSON.stringify(inherited));
      console.log('replaced ' + JSON.stringify(replaced));
    })().finally(() => {
      clearInterval(keepalive);
      restore('PARENT_ONLY', previous.parent);
      restore('REPLACED', previous.replaced);
      restore('EXPLICIT_ONLY', previous.explicit);
      restore('RIFTY_PARITY_HOST_BOOTSTRAP', previous.host);
    });
  `,
  expected:
    'inherited {"parent":"parent","explicit":null,"replaced":"parent","hostOwn":false,"hostValue":null}\n' +
    'replaced {"parent":null,"explicit":"explicit","replaced":null,"hostOwn":true,"hostValue":"guest-visible"}\n',
  kind: 'worker-env',
};

export default c;
