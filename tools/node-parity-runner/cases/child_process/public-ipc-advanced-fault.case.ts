import type { ParityCase } from '../../src/types.ts';

// Real local send failures: neither a malformed application value nor a clone
// failure may poison the public channel or dispatch a partial message.
const failures = `
  function rejectedSends(send) {
    const result = [];
    for (const [label, message] of [
      ['undefined', undefined], ['function', () => {}],
      ['symbol', Symbol('x')], ['bigint', 1n],
      ['nested-function', { bad() {} }],
      ['nested-symbol', { bad: Symbol('x') }],
      ['weakmap', { bad: new WeakMap() }],
      ...[
        ['weakmap', new WeakMap()], ['weakset', new WeakSet()],
        ['promise', Promise.resolve(1)],
        ['weakref', new WeakRef({})], ['finalization', new FinalizationRegistry(() => {})],
      ].map(([label, value]) => [label + '-severed', {
        bad: Object.freeze(Object.setPrototypeOf(value, null)),
      }]),
    ]) {
      try { send(message); result.push([label, 'NO_THROW']); }
      catch (error) {
        // Argument errors remain Node-shaped; intrinsic clone errors follow the platform.
        result.push(label === 'undefined' || label === 'function' || label === 'symbol' || label === 'bigint'
          ? [label, error.name, error.code ?? null]
          : [label, 'rejected']);
      }
    }
    const ordinary = new Error('getter failed');
    const renamed = new Error('renamed getter failed');
    renamed.name = 'DataCloneError';
    let nativeCloneError;
    try { structuredClone(() => {}); } catch (error) { nativeCloneError = error; }
    for (const [label, sentinel] of [['ordinary', ordinary], ['renamed', renamed], ['native-clone-error', nativeCloneError]]) {
      const order = [];
      try { send({ get value() { order.push('getter'); throw sentinel; } }); }
      catch (error) { order.push(error === sentinel ? 'same-error' : 'wrong-error'); }
      order.push('after-send');
      result.push(['getter-' + label, order]);
    }
    return result;
  }
`;

const c: ParityCase = {
  kind: 'child-worker',
  expectedPhysicalWorkers: 1,
  cwd: '/project',
  setup: {
    files: {
      'project/advanced-fault.cjs': `
        ${failures}
        const seen = [];
        process.on('message', message => {
          seen.push(message.sequence);
          if (message.sequence === 2) process.send({ tag: 'done', seen });
        });
        const invalid = rejectedSends(message => process.send(message));
        process.send({ tag: 'ready', invalid, connected: process.connected });
        setInterval(() => {}, 1000);
      `,
    },
  },
  code: `
    ${failures}
    const { fork } = require('node:child_process');
    void new Promise((resolve, reject) => {
      const child = fork('advanced-fault.cjs', [], {
        cwd: process.cwd(), serialization: 'advanced', stdio: 'pipe',
      });
      const result = {};
      child.on('error', reject);
      child.on('message', message => {
        if (message.tag === 'ready') {
          result.childInvalid = message.invalid;
          result.childConnected = message.connected;
          child.send({ sequence: 1 });
          result.parentInvalid = rejectedSends(value => child.send(value));
          result.parentConnected = child.connected;
          child.send({ sequence: 2 });
          return;
        }
        result.seen = message.seen;
        child.once('exit', (code, signal) => {
          result.exit = { code, signal };
          resolve(result);
        });
        child.kill('SIGUSR2');
      });
    }).then(result => console.log(JSON.stringify(result)))
      .catch(error => console.log('case-error:' + error.name + ':' + error.message));
  `,
};

export default c;
