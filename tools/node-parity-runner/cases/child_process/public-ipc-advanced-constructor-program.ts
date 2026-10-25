import type { ParityCase } from '../../src/types.ts';

/** Same input for Node's successful sends and rifty's explicit constructor ceiling. */
export const constructorCase: ParityCase = {
  kind: 'child-worker',
  expectedPhysicalWorkers: 1,
  cwd: '/project',
  setup: {
    files: {
      'project/echo.cjs': `
      const { Buffer } = require('node:buffer');
      process.on('message', ({ label, view }) => {
        process.send(label === 'after' ? label : label + ':' + [...view] + ':' + Buffer.isBuffer(view));
      });
    `,
    },
  },
  code: `
    const { fork } = require('node:child_process');
    const { Buffer } = require('node:buffer');
    const child = fork('echo.cjs', [], { serialization: 'advanced', stdio: 'pipe' });
    const received = [];
    child.on('message', message => {
      received.push(message);
      if (message === 'after') {
        console.log('received ' + JSON.stringify(received));
        child.disconnect();
      }
    });
    for (const label of ['own', 'inherited', 'data', 'subclass', 'buffer']) {
      class Bytes extends Uint8Array {}
      const view = label === 'subclass' ? new Bytes([1]) : label === 'buffer' ? Buffer.from([1]) : new Uint8Array([1]);
      const calls = [];
      if (label === 'own' || label === 'inherited') {
        const owner = label === 'own' ? view : Object.create(Uint8Array.prototype);
        Object.defineProperty(owner, 'constructor', { get() { calls.push('constructor'); view[0] = 2; return Uint8Array; } });
        if (label === 'inherited') Object.setPrototypeOf(view, owner);
      }
      if (label === 'data') Object.defineProperty(view, 'constructor', { value: Buffer });
      try { child.send({ label, view }); console.log(label + ' sent ' + JSON.stringify(calls)); }
      catch (e) { console.log(label + ' ' + e.name + ':' + e.feature + ' ' + JSON.stringify(calls)); }
    }
    child.send({ label: 'after' });
  `,
};

export const constructorNodeRows = [
  'own sent ["constructor"]',
  'inherited sent ["constructor"]',
  'data sent []',
  'subclass sent []',
  'buffer sent []',
  'received ["own:2:false","inherited:2:false","data:1:true","subclass:1:false","buffer:1:true","after"]',
];
export const constructorRiftyRows = [
  'own NotImplementedError:child_process.serialization.advanced.constructor-accessor []',
  'inherited NotImplementedError:child_process.serialization.advanced.constructor-accessor []',
  'data sent []',
  'subclass sent []',
  'buffer sent []',
  'received ["data:1:true","subclass:1:false","buffer:1:true","after"]',
];
