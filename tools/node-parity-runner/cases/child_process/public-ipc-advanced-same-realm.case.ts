/**
 * Advanced fork IPC on rifty's same-realm fallback route (no SAB Worker lane),
 * which this runner mode exercises (ADR-0448): the same encoder/decoder as the
 * Worker route, so a message is a copy fixed at `send()`, never a shared
 * reference, and keeps Buffer, Map, `undefined` and refusal errors as in Node.
 */
import type { ParityCase } from '../../src/types.ts';
import { DESCRIBE_SOURCE } from './advanced-ipc-program.ts';

const c: ParityCase = {
  cwd: '/project',
  setup: {
    files: {
      // Ambient 'process': the same-realm route passes it as a wrapper
      // parameter, so a top-level 'const process' would not parse there.
      'project/once.cjs': `
        const { Buffer } = require('node:buffer');
        ${DESCRIBE_SOURCE}
        process.once('message', (message) => {
          const saw = describe(message);
          message.list.push('child-write');
          process.send({ saw, echo: message, fromChild: Buffer.from('child') });
          process.disconnect();
        });
      `,
    },
  },
  code: `
    const { fork } = require('node:child_process');
    const { Buffer } = require('node:buffer');
    const cwd = require('node:process').cwd();
    ${DESCRIBE_SOURCE}
    const rows = [];
    const row = (label, value) => rows.push(label + ' ' + JSON.stringify(value));

    void (async () => {
      const child = fork('once.cjs', [], { cwd, serialization: 'advanced' });
      const events = [];
      const reply = new Promise((resolve) => child.once('message', resolve));
      child.on('disconnect', () => events.push('disconnect'));
      const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));

      const circular = { name: 'c' };
      circular.self = circular;
      const message = {
        list: [1],
        map: new Map([['k', new Set([1])]]),
        date: new Date(0),
        u: undefined,
        buffer: Buffer.from('hi'),
        bytes: new Uint8Array([1, 2]),
        error: new TypeError('t'),
        circular,
      };
      try {
        child.send({ fn() {} });
        row('refused', 'sent');
      } catch (error) {
        row('refused', { class: error.constructor.name, code: error.code ?? null, message: error.message });
      }
      child.send(message);
      message.list.push('parent-write');
      message.buffer.write('HI');

      const answer = await reply;
      row('child-saw', answer.saw);
      row('echo', describe(answer.echo));
      row('from-child', describe(answer.fromChild));
      row('parent-object-after-reply', describe(message.list));
      row('echo-is-not-sent-object', answer.echo !== message);
      row('exit', await exited);
      row('events', events);

      console.log(rows.join('\\n'));
    })().catch((error) => {
      console.log('case-error:' + error.name + ':' + error.message);
    });
  `,
};

export default c;
