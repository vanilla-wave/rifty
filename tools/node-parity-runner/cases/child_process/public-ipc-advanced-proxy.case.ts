import type { ParityCase } from '../../src/types.ts';

// Compare rejection/trap semantics; platform clone-error shape has separate browser assertions.
const exercise = `
  function proxyFailures(send) {
    const traps = [];
    const handler = {
      get(target, key, receiver) { traps.push('get'); return Reflect.get(target, key, receiver); },
      getPrototypeOf(target) { traps.push('prototype'); return Reflect.getPrototypeOf(target); },
      ownKeys(target) { traps.push('keys'); return Reflect.ownKeys(target); },
    };
    const revocable = Proxy.revocable({ value: 1 }, handler);
    const revoked = Proxy.revocable({ value: 1 }, handler);
    revoked.revoke();
    const failures = [];
    for (const [label, value] of [
      ['proxy', new Proxy({ value: 1 }, handler)],
      ['revocable', revocable.proxy], ['revoked', revoked.proxy],
    ]) {
      try { send({ bad: value }); failures.push([label, 'NO_THROW']); }
      catch { failures.push([label, 'rejected']); }
    }
    let reads = 0;
    send({ tag: 'control', get values() { reads++; return [1, 2, 255]; } });
    return { failures, traps, reads, proxyShape: [
      Proxy.name, Proxy.length, typeof Proxy.prototype,
      Proxy.revocable === Object.getOwnPropertyDescriptor(Proxy, 'revocable').value,
      Function.prototype.toString.call(Proxy),
      Function.prototype.toString.call(Proxy.revocable),
      Function.prototype.toString.call(Function.prototype.toString),
    ] };
  }
`;

const c: ParityCase = {
  kind: 'child-worker',
  expectedPhysicalWorkers: 1,
  cwd: '/project',
  setup: {
    files: {
      'project/proxy-fault.cjs': `
        ${exercise}
        process.on('message', message => {
          if (message.tag === 'control') process.send({ tag: 'echo', array: Array.isArray(message.values), values: message.values });
        });
        process.send({ tag: 'ready', outcome: proxyFailures(value => process.send(value)) });
        setInterval(() => {}, 1000);
      `,
    },
  },
  code: `
    ${exercise}
    const { fork } = require('node:child_process');
    void new Promise((resolve, reject) => {
      const child = fork('proxy-fault.cjs', [], { cwd: process.cwd(), serialization: 'advanced', stdio: 'pipe' });
      const result = {};
      child.on('error', reject);
      child.on('message', message => {
        if (message.tag === 'control') result.childControl = [Array.isArray(message.values), message.values];
        if (message.tag === 'ready') {
          result.child = message.outcome;
          result.parent = proxyFailures(value => child.send(value));
        }
        if (message.tag === 'echo') {
          result.parentControl = [message.array, message.values];
          child.once('exit', () => resolve(result));
          child.kill('SIGUSR2');
        }
      });
    }).then(result => console.log(JSON.stringify(result)))
      .catch(error => console.log('case-error:' + error.name + ':' + error.message));
  `,
};

export default c;
