import type { ParityCase } from '../../src/types.ts';

// runtime-js/vm-run-in-this-context-offsets (I4/I5): lineOffset/columnOffset
// shift reported positions (no clamping; negative columns display). Node
// v24.16.0 oracle 2026-10-05: 1:-19 / 11:28 / 4:1 + RangeError for a
// fractional columnOffset.
const c: ParityCase = {
  code: `
    const vm = require('node:vm');
    const a = vm.runInThisContext('new Error().stack', {
      filename: '/virtual/mod.js',
      lineOffset: 0,
      columnOffset: -20,
    });
    console.log(a.split('\\n')[1]);
    const s = new vm.Script('function f() { return new Error().stack; }\\nf();', {
      filename: '/virtual/mod2.js',
      lineOffset: 10,
      columnOffset: 5,
    });
    console.log(s.runInThisContext().split('\\n')[1]);
    const b = vm.runInThisContext('new Error().stack', { filename: '/v/b.js', lineOffset: 3 });
    console.log(b.split('\\n')[1]);
    try {
      vm.runInThisContext('0;', { columnOffset: 1.5 });
      console.log('no-throw');
    } catch (e) {
      console.log(e.name + '/' + e.code);
    }
  `,
};

export default c;
