import type { ParityCase } from '../../src/types.ts';

const childSource = `
  const p = typeof __process === 'undefined' ? process : __process;
  const onMessage = typeof p.onMessage === 'function'
    ? (handler) => p.onMessage(handler)
    : (handler) => p.on('message', handler);
  const value = {
    date: new Date('2020-01-02T03:04:05.000Z'),
    map: new Map([['key', 7]]),
    missing: [undefined],
    bytes: new Uint8Array([0, 128, 255]),
    big: 9n,
  };
  value.self = value;
  onMessage((message) => p.send(message));
  p.send({ kind: 'ready', value });
`;

const c: ParityCase = {
  kind: 'child-worker',
  expectedPhysicalWorkers: 1,
  cwd: '/project',
  setup: { files: { 'project/child.js': childSource } },
  code: `
    const { fork } = require('node:child_process');
    const cwd = require('node:process').cwd();
    const value = {
      date: new Date('2022-03-04T05:06:07.000Z'),
      map: new Map([['key', 11]]),
      missing: [undefined],
      bytes: new Uint8Array([1, 127, 254]),
      big: 13n,
    };
    value.self = value;
    const shape = (message) => ({
      date: message.date instanceof Date && message.date.toISOString(),
      map: message.map instanceof Map && message.map.get('key'),
      missing: message.missing.length === 1 && message.missing[0] === undefined,
      bytes: message.bytes instanceof Uint8Array && [...message.bytes].join(','),
      big: typeof message.big === 'bigint' && message.big.toString(),
      cycle: message.self === message,
    });

    void new Promise((resolve) => {
      const child = fork('child.js', [], {
        cwd,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        serialization: 'advanced',
      });
      const messages = [];
      const invalid = [];
      child.on('message', (message) => {
        if (message.kind === 'ready') {
          messages.push(['ready', shape(message.value)]);
          for (const [label, candidate] of [
            ['missing', undefined],
            ['function', () => {}],
            ['nested-function', { fn() {} }],
          ]) {
            try {
              child.send(candidate);
              invalid.push(label + ':NO_THROW');
            } catch (error) {
              invalid.push(label + ':' + error.name + '/' + (error.code ?? 'no-code'));
            }
          }
          child.send({ kind: 'echo', value });
          child.send({ kind: 'after' });
          return;
        }
        if (message.kind === 'echo') {
          messages.push(['echo', shape(message.value)]);
          return;
        }
        messages.push(['after']);
        const connectedBefore = child.connected;
        child.disconnect();
        const connectedAfter = child.connected;
        child.once('exit', (code, signal) => {
          resolve({ messages, invalid, connectedBefore, connectedAfter,
            exit: { code, signal } });
        });
      });
    }).then((result) => console.log(JSON.stringify(result))).catch((error) => {
      console.log('case-error:' + error.name + ':' + error.message);
    });
  `,
  expected:
    '{"messages":[["ready",{"date":"2020-01-02T03:04:05.000Z","map":7,' +
    '"missing":true,"bytes":"0,128,255","big":"9","cycle":true}],' +
    '["echo",{"date":"2022-03-04T05:06:07.000Z","map":11,' +
    '"missing":true,"bytes":"1,127,254","big":"13","cycle":true}],["after"]],' +
    '"invalid":["missing:TypeError/ERR_MISSING_ARGS",' +
    '"function:TypeError/ERR_INVALID_ARG_TYPE","nested-function:Error/no-code"],' +
    '"connectedBefore":true,"connectedAfter":false,"exit":{"code":0,"signal":null}}\n',
};

export default c;
