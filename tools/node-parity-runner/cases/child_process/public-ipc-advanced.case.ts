import type { ParityCase } from '../../src/types.ts';

// Binary success criteria removed by the explicit epic amendment; tracked as ceilings.
const values = `
  let getterReads = 0;
  function value() {
    const shared = { n: 7 };
    const result = {
      date: new Date('2020-01-02T03:04:05.000Z'),
      map: new Map([['key', shared]]), set: new Set([shared]),
      regexp: /test/gi, values: [1, 2, 255], bigint: 9007199254740993n,
      error: new TypeError('failure', { cause: new Error('cause') }),
      array: [undefined, NaN, Infinity, -0], shared,
    };
    result.self = result;
    Object.defineProperty(result, 'sharedAlias', {
      enumerable: true, get() {
        getterReads++;
        return result.shared;
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
      values: [Array.isArray(v.values), v.values],
      alias: v.sharedAlias === v.shared,
      bigint: [typeof v.bigint, String(v.bigint)],
      error: [v.error instanceof TypeError, v.error.message, v.error.cause.message],
      array: [v.array.length, 0 in v.array, v.array[0] === undefined,
        Number.isNaN(v.array[1]), v.array[2] === Infinity, Object.is(v.array[3], -0)],
      cycle: v.self === v, shared: v.shared.n,

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
        initial.shared.n = 99;
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
          sent.values[0] = 99;
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
