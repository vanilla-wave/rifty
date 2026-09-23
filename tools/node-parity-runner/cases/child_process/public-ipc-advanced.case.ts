import type { ParityCase } from '../../src/types.ts';

const values = `
  const { Buffer } = require('node:buffer');
  let getterReads = 0;
  function value() {
    const shared = { n: 7 };
    const sharedBytes = new Uint8Array(new SharedArrayBuffer(8));
    sharedBytes.set([1, 2, 3, 4, 5, 6, 7, 8]);
    const sharedView = new Uint8Array(sharedBytes.buffer, 2, 4);
    const result = {
      date: new Date('2020-01-02T03:04:05.000Z'),
      map: new Map([['key', shared]]), set: new Set([shared]),
      regexp: /test/gi, bytes: new Uint8Array([1, 2, 255]),
      buffer: Buffer.from([4, 5, 254]), bigint: 9007199254740993n,
      error: new TypeError('failure', { cause: new Error('cause') }),
      array: [undefined, NaN, Infinity, -0], shared,
      sharedView, sharedViewAlias: sharedView,
      sharedData: new DataView(sharedBytes.buffer, 2, 4),
    };
    result.self = result;
    Object.defineProperty(result, 'bufferAlias', {
      enumerable: true, get() {
        getterReads++;
        sharedBytes.fill(88);
        return result.buffer;
      },
    });
    return result;
  }
  function describe(v) {
    return {
      date: [v.date instanceof Date, v.date.toISOString()],
      map: [v.map instanceof Map, v.map.get('key') === v.shared],
      set: [v.set instanceof Set, v.set.has(v.shared)],
      regexp: [v.regexp instanceof RegExp, v.regexp.source, v.regexp.flags],
      bytes: [v.bytes instanceof Uint8Array, Array.from(v.bytes)],
      buffer: [Buffer.isBuffer(v.buffer), Array.from(v.buffer), v.bufferAlias === v.buffer],
      bigint: [typeof v.bigint, String(v.bigint)],
      error: [v.error instanceof TypeError, v.error.message, v.error.cause.message],
      array: [v.array.length, 0 in v.array, v.array[0] === undefined,
        Number.isNaN(v.array[1]), v.array[2] === Infinity, Object.is(v.array[3], -0)],
      cycle: v.self === v, shared: v.shared.n,
      sharedView: [v.sharedView instanceof Uint8Array, Array.from(v.sharedView),
        v.sharedView === v.sharedViewAlias, v.sharedView.buffer instanceof ArrayBuffer],
      sharedData: [v.sharedData instanceof DataView,
        Array.from(new Uint8Array(v.sharedData.buffer, v.sharedData.byteOffset,
          v.sharedData.byteLength)), v.sharedData.buffer instanceof ArrayBuffer],
    };
  }
`;

const c: ParityCase = {
  kind: 'child-worker',
  expectedPhysicalWorkers: 1,
  cwd: '/project',
  setup: {
    files: {
      'project/advanced.cjs': `
        ${values}
        process.on('message', message => {
          process.send({ tag: 'echo', received: describe(message), value: message });
        });
        const initial = value();
        process.send({ tag: 'ready', value: initial });
        initial.sharedView.fill(99);
        setInterval(() => {}, 1000);
      `,
    },
  },
  code: `
    ${values}
    const { fork } = require('node:child_process');
    void new Promise((resolve, reject) => {
      const child = fork('advanced.cjs', [], {
        cwd: process.cwd(), serialization: 'advanced', stdio: 'pipe',
      });
      const result = {};
      child.on('error', reject);
      child.on('message', message => {
        if (message.tag === 'ready') {
          result.childValue = describe(message.value);
          const sent = value();
          const before = getterReads;
          result.sendReturned = child.send(sent);
          result.getterReads = getterReads - before;
          sent.shared.n = 99;
          sent.bytes[0] = 99;
          sent.sharedView.fill(99);
          return;
        }
        result.childReceived = message.received;
        result.echo = describe(message.value);
        result.connectedBefore = child.connected;
        child.disconnect();
        result.connectedAfter = child.connected;
        child.once('exit', (code, signal) => {
          result.exit = { code, signal };
          resolve(result);
        });
        result.killAfterDisconnect = child.kill('SIGUSR2');
      });
    }).then(result => console.log(JSON.stringify(result)))
      .catch(error => console.log('case-error:' + error.name + ':' + error.message));
  `,
};

export default c;
