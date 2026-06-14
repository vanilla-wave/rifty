import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    globalThis.__RIFTY_VM_ENGINE = 'quickjs';
    const vm = require('node:vm');
    console.log(vm.runInNewContext('40 + 2'));
    console.log(vm.runInNewContext('"a" + "b"'));
    console.log(vm.runInNewContext('true && false'));
    console.log(vm.runInNewContext('null'));
    console.log(String(vm.runInNewContext('undefined')));
    console.log(vm.runInNewContext('1n + 2n'));
  `,
  // Node's console.log renders the bigint completion value as `3n` (the trailing
  // `n` is verified via the parity runner against real Node, not assumed).
  expected: '42\nab\nfalse\nnull\nundefined\n3n\n',
};

export default c;
