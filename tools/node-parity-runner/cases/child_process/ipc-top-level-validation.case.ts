/** Top-level child-process IPC validation is distinct from nested JSON failures. */
import type { ParityCase } from '../../src/types.ts';

const childSource = 'setInterval(() => {}, 1_000);';

const c: ParityCase = {
  setup: { files: { 'ipc-validation-child.js': childSource } },
  code: `
    const { fork } = require('node:child_process');
    const child = fork('ipc-validation-child.js', [], { cwd: require('node:process').cwd() });
    const circular = {};
    circular.self = circular;
    const samples = [
      ['undefined', undefined],
      ['function', () => {}],
      ['symbol', Symbol('message')],
      ['bigint', 1n],
      ['nested-bigint', { value: 1n }],
      ['circular', circular],
    ];

    for (const [label, value] of samples) {
      try {
        child.send(value);
        console.log(label + ':NO_THROW');
      } catch (error) {
        console.log(label + ':' + error.name + '/' + (error.code || 'no-code'));
      }
    }
    child.kill();
  `,
  expected:
    'undefined:TypeError/ERR_MISSING_ARGS\n' +
    'function:TypeError/ERR_INVALID_ARG_TYPE\n' +
    'symbol:TypeError/ERR_INVALID_ARG_TYPE\n' +
    'bigint:TypeError/ERR_INVALID_ARG_TYPE\n' +
    'nested-bigint:TypeError/no-code\n' +
    'circular:TypeError/no-code',
};

export default c;
