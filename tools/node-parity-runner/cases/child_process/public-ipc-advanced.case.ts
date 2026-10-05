/**
 * runtime-js/child-process-advanced-ipc-serialization: `fork` with
 * `serialization: 'advanced'` round-trips structured-clone values (Node v24
 * oracle, evidence §Oracle: Date/Map/[undefined]/Uint8Array types intact,
 * bigint OK, function send → ERR_INVALID_ARG_TYPE). The JSON default is a
 * separate case (public-ipc-json).
 */
import type { ParityCase } from '../../src/types.ts';

const advancedChild = `
  const p = typeof __process === 'undefined' ? process : __process;
  const onMessage = typeof p.onMessage === 'function'
    ? (handler) => p.onMessage(handler)
    : (handler) => p.on('message', handler);
  p.send({
    d: new Date(0),
    m: new Map([['a', 1]]),
    u: [undefined],
    b: new Uint8Array([1, 2]),
    g: 1n,
  });
  onMessage((message) => p.send(message));
  setInterval(() => {}, 1000);
`;

const c: ParityCase = {
  kind: 'child-worker',
  expectedPhysicalWorkers: 1,
  cwd: '/project',
  setup: {
    files: {
      'project/advanced.js': advancedChild,
    },
  },
  code: `
    const { fork } = require('node:child_process');
    const cwd = require('node:process').cwd();

    void (async () => {
      const result = await new Promise((resolve) => {
        const child = fork('advanced.js', [], {
          cwd,
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
          serialization: 'advanced',
        });
        let probe = null;
        let roundtrip = null;
        let fnSend = null;
        child.on('message', (message) => {
          if (probe === null) {
            probe = {
              d: message.d instanceof Date && message.d.getTime() === 0,
              m: message.m instanceof Map && message.m.get('a') === 1,
              u: Array.isArray(message.u) && message.u.length === 1 && message.u[0] === undefined && '0' in message.u,
              b: message.b instanceof Uint8Array && message.b[1] === 2,
              g: typeof message.g === 'bigint' && message.g === 1n,
            };
            child.send({
              d: new Date(7),
              m: new Map([['k', new Date(5)]]),
              u: [undefined],
              b: new Uint8Array([9]),
              g: 2n,
            });
            return;
          }
          roundtrip = {
            d: message.d instanceof Date && message.d.getTime() === 7,
            m: message.m instanceof Map && message.m.get('k') instanceof Date && message.m.get('k').getTime() === 5,
            u: Array.isArray(message.u) && message.u.length === 1 && message.u[0] === undefined && '0' in message.u,
            b: message.b instanceof Uint8Array && message.b[0] === 9,
            g: typeof message.g === 'bigint' && message.g === 2n,
          };
          try {
            child.send(() => {});
            fnSend = 'NO_THROW';
          } catch (error) {
            fnSend = error.name + '/' + (error.code ?? 'no-code');
          }
          child.disconnect();
          const killed = child.kill('SIGUSR2');
          child.once('exit', (code, signal) => {
            resolve({ probe, roundtrip, fnSend, killed, exit: { code, signal } });
          });
        });
      });
      console.log(JSON.stringify(result));
    })().catch((error) => {
      console.log('case-error:' + error.name + ':' + (error.code ?? error.message));
    });
  `,
  expected:
    '{"probe":{"d":true,"m":true,"u":true,"b":true,"g":true},"roundtrip":{"d":true,"m":true,"u":true,"b":true,"g":true},' +
    '"fnSend":"TypeError/ERR_INVALID_ARG_TYPE","killed":true,' +
    '"exit":{"code":null,"signal":"SIGUSR2"}}',
};

export default c;
