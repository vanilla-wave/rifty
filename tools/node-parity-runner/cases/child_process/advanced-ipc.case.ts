import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  kind: 'child-worker',
  expectedPhysicalWorkers: 1,
  cwd: '/project',
  setup: {
    files: {
      'project/advanced.cjs': `
    const p = typeof __process === 'undefined' ? process : __process;
    const receive = typeof p.onMessage === 'function' ? cb => p.onMessage(cb) : cb => p.on('message', cb);
    receive(message => { p.send(message); });
  `,
    },
  },
  code: `
    const { fork } = require('node:child_process');
    const process = require('node:process');
    const { Buffer } = require('node:buffer');
    const child = fork('advanced.cjs', [], {cwd: process.cwd(), serialization:'advanced', stdio:['ignore','ignore','ignore','ipc']});
    child.on('error', error => { throw error; });
    child.on('message', value => {
      console.log(value.date instanceof Date, value.map instanceof Map, value.set instanceof Set, value.bytes instanceof Uint8Array, value.array[0] === undefined, value.self === value);
      console.log(Buffer.isBuffer(value.accessorBuffer), value.accessorBuffer[0], Buffer.isBuffer(value.sharedBuffer), value.sharedBuffer[0]);
      console.log(value.date.toISOString(), value.map.get('key'), value.set.has(3), Array.from(value.bytes).join(','));
      console.log(Buffer.isBuffer(value.buffer), value.buffer === value.bufferAgain, value.map.get('buffer') === value.buffer, value.buffer.toString('hex'));
      child.kill('SIGKILL');
    });
    child.on('close', () => console.log('closed'));
    const value = {date:new Date(0),map:new Map([['key',7]]),set:new Set([3]),bytes:new Uint8Array([1,2]),array:[undefined]}; value.self = value; value.buffer = Buffer.from([3,4]); value.bufferAgain = value.buffer; value.map.set('buffer', value.buffer);
    let gets = 0;
    Object.defineProperty(value, 'accessorBuffer', { enumerable: true, get() { return Buffer.from([++gets]); } });
    Object.setPrototypeOf(value.date, null); Object.setPrototypeOf(value.map, null); Object.setPrototypeOf(value.set, null);
    value.sharedBuffer = Buffer.from(new SharedArrayBuffer(1)); value.sharedBuffer[0] = 1;
    child.send(value); value.sharedBuffer[0] = 2;
    for (const proxy of [new Proxy({x:1}, {}), Proxy.revocable({x:1}, {}).proxy]) {
      try { child.send(proxy); console.log('BAD-PROXY'); } catch { console.log('proxy rejected'); }
    }
    const promise = Promise.resolve(1); Object.setPrototypeOf(promise, null);
    let opaqueGets = 0;
    for (const opaque of [promise, new WeakRef({}), new FinalizationRegistry(() => {})]) {
      Object.defineProperty(opaque, 'buffer', {enumerable:true, get() { opaqueGets++; return Buffer.from([8]); }});
      try { child.send(opaque); console.log('BAD-OPAQUE'); } catch { console.log('opaque rejected'); }
    }
    console.log('opaque gets', opaqueGets);
    console.log('gets', gets);
    try { child.send(() => {}); } catch (error) { console.log(error.code); }
  `,
};

export default c;
