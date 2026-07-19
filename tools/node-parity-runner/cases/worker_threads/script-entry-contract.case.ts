import type { ParityCase } from '../../src/types.ts';

// Worker string entries are paths, not URL specifiers. Validation is
// synchronous and happens before Node allocates a thread id.
const c: ParityCase = {
  setup: {
    files: {
      'app/worker.mjs':
        'import { parentPort } from "node:worker_threads"; parentPort.postMessage("parent");\n',
      'app/sub/worker.mjs':
        'import { parentPort } from "node:worker_threads"; parentPort.postMessage("sub");\n',
    },
  },
  cwd: '/app/sub',
  code: `
    const { Worker } = require('node:worker_threads');
    const { resolve } = require('node:path');
    const { pathToFileURL } = require('node:url');

    console.warn = () => {};
    const terminations = [];
    function capture(label, entry) {
      try {
        const worker = new Worker(entry);
        worker.on('error', () => {});
        console.log(label + ':RETURN:' + worker.threadId);
        terminations.push(Promise.resolve(worker.terminate()));
      } catch (error) {
        console.log(label + ':' + error.name + ':' + error.code);
      }
    }

    function run(label, entry) {
      return new Promise((resolveRun, reject) => {
        let worker;
        try {
          worker = new Worker(entry);
          console.log(label + ':RETURN:' + worker.threadId);
        } catch (error) {
          console.log(label + ':' + error.name + ':' + error.code);
          resolveRun(label + ':ERROR');
          return;
        }
        let received = false;
        worker.once('message', (message) => {
          received = true;
          Promise.resolve(worker.terminate()).then(() => resolveRun(label + ':' + message), reject);
        });
        worker.once('error', reject);
        worker.once('exit', (code) => {
          if (!received) reject(new Error(label + ' exited before message: ' + code));
        });
      });
    }

    capture('bare', 'worker.js');
    capture('file-string', 'file:///app/sub/worker.js');
    capture('file-string-mixed', 'FiLe:///app/sub/worker.js');
    capture('data-string', 'data:text/javascript,0');
    capture('https-string', 'https://example.test/worker.js');
    capture('https-url', new URL('https://example.test/worker.js'));
    capture('invalid-object', {});
    capture('data-url', new URL('data:text/javascript,0'));

    const fileUrl = pathToFileURL(resolve('worker.mjs'));
    const urlShape = {
      href: fileUrl.href,
      protocol: fileUrl.protocol,
      hostname: fileUrl.hostname,
      pathname: fileUrl.pathname,
    };
    const keepalive = setInterval(() => {}, 10);
    Promise.all([
      run('url-shape', urlShape),
      run('absolute', resolve('worker.mjs')),
      run('dot-relative', './worker.mjs'),
      run('dotdot-relative', '../worker.mjs'),
    ]).then((messages) => {
      console.log('messages:' + JSON.stringify(messages));
    }).finally(() => {
      clearInterval(keepalive);
    });

    void Promise.all(terminations);
  `,
  expected: [
    'bare:TypeError:ERR_WORKER_PATH',
    'file-string:TypeError:ERR_WORKER_PATH',
    'file-string-mixed:TypeError:ERR_WORKER_PATH',
    'data-string:TypeError:ERR_WORKER_PATH',
    'https-string:TypeError:ERR_WORKER_PATH',
    'https-url:TypeError:ERR_INVALID_URL_SCHEME',
    'invalid-object:TypeError:ERR_INVALID_ARG_TYPE',
    'data-url:RETURN:1',
    'url-shape:RETURN:2',
    'absolute:RETURN:3',
    'dot-relative:RETURN:4',
    'dotdot-relative:RETURN:5',
    'messages:["url-shape:sub","absolute:sub","dot-relative:sub","dotdot-relative:parent"]',
    '',
  ].join('\n'),
};

export default c;
