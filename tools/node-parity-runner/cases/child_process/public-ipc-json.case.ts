/**
 * Plain spawn has no public IPC; fork owns default JSON, disconnect, and
 * circular-send recovery without leaking private control.
 */
import type { ParityCase } from '../../src/types.ts';

const plainChild = `
  const p = typeof __process === 'undefined' ? process : __process;
  const write = typeof __stdout_write === 'function'
    ? __stdout_write
    : (chunk) => p.stdout.write(chunk);
  write(JSON.stringify({
    sendType: typeof p.send,
    connected: p.connected ?? null,
    channelNull: (p.channel ?? null) === null,
  }));
`;

const ipcChild = `
  const p = typeof __process === 'undefined' ? process : __process;
  const onMessage = typeof p.onMessage === 'function'
    ? (handler) => p.onMessage(handler)
    : (handler) => p.on('message', handler);
  p.send({ fromChild: 1, dropped() {} });
  onMessage((message) => p.send(message));
  setInterval(() => {}, 1000);
`;

const c: ParityCase = {
  kind: 'child-worker',
  expectedPhysicalWorkers: 2,
  cwd: '/project',
  setup: {
    files: {
      'project/plain.js': plainChild,
      'project/ipc.js': ipcChild,
    },
  },
  code: `
    const { fork, spawn } = require('node:child_process');
    const cwd = require('node:process').cwd();

    void (async () => {
      const plain = await new Promise((resolve) => {
        const child = spawn('node', ['plain.js'], { cwd });
        const parent = {
          sendType: typeof child.send,
          connected: child.connected,
          channelNull: (child.channel ?? null) === null,
          stdio: child.stdio.map((slot) => slot !== null),
        };
        let stdout = '';
        child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
        child.on('close', () => resolve({ parent, guest: JSON.parse(stdout) }));
      });

      const ipc = await new Promise((resolve) => {
        const child = fork('ipc.js', [], {
          cwd,
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        });
        const messages = [];
        let circular = null;
        const validation = [];
        child.on('message', (message) => {
          messages.push(message);
          if (messages.length === 1) {
            child.send({ fromParent: 1, dropped() {} });
            return;
          }
          if (messages.length === 2) {
            const value = {};
            value.self = value;
            try {
              child.send(value);
            } catch (error) {
              circular = {
                name: error.name,
                code: error.code ?? null,
                mentionsCircular: /circular/i.test(error.message),
              };
            }
            child.send({ after: true });
            return;
          }
          const connectedBefore = child.connected;
          child.disconnect();
          const connectedAfter = child.connected;
          child.once('exit', (code, signal) => {
            resolve({
              messages,
              circular,
              connectedBefore,
              connectedAfter,
              validation,
              killAfterDisconnect,
              exit: { code, signal },
            });
          });
          const killAfterDisconnect = child.kill('SIGUSR2');
        });
        for (const [label, value] of [
          ['undefined', undefined],
          ['function', () => {}],
          ['symbol', Symbol('message')],
          ['bigint', 1n],
          ['nested-bigint', { value: 1n }],
        ]) {
          try {
            child.send(value);
            validation.push(label + ':NO_THROW');
          } catch (error) {
            validation.push(label + ':' + error.name + '/' + (error.code ?? 'no-code'));
          }
        }
      });

      console.log(JSON.stringify({ plain, ipc }));
    })().catch((error) => {
      console.log('case-error:' + error.name + ':' + error.message);
    });
  `,
  expected:
    '{"plain":{"parent":{"sendType":"undefined","connected":false,"channelNull":true,' +
    '"stdio":[true,true,true]},"guest":{"sendType":"undefined","connected":null,' +
    '"channelNull":true}},"ipc":{"messages":[{"fromChild":1},{"fromParent":1},{"after":true}],' +
    '"circular":{"name":"TypeError","code":null,"mentionsCircular":true},' +
    '"connectedBefore":true,"connectedAfter":false,' +
    '"validation":["undefined:TypeError/ERR_MISSING_ARGS",' +
    '"function:TypeError/ERR_INVALID_ARG_TYPE","symbol:TypeError/ERR_INVALID_ARG_TYPE",' +
    '"bigint:TypeError/ERR_INVALID_ARG_TYPE","nested-bigint:TypeError/no-code"],' +
    '"killAfterDisconnect":true,' +
    '"exit":{"code":null,"signal":"SIGUSR2"}}}',
};

export default c;
