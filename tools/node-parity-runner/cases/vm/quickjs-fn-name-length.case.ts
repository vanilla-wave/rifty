import type { ParityCase } from '../../src/types.ts';

// T10 (carried T6/T9 fidelity) — a guest function returned to the host must
// report the GUEST function's `name` and `length`, not the host thunk's (0/'').
// Node is the oracle. `length` counts params before the first default/rest.
const c: ParityCase = {
  code: `
    globalThis.__RIFTY_VM_ENGINE = 'quickjs';
    const vm = require('node:vm');
    const fn = vm.runInNewContext('(function foo(a,b,c){return a})');
    console.log('named', JSON.stringify(fn.name), fn.length, fn(7,8,9));
    const arrow = vm.runInNewContext('((x,y)=>x)');
    console.log('arrow', JSON.stringify(arrow.name), arrow.length);
    const anon = vm.runInNewContext('(function(){})');
    console.log('anon', JSON.stringify(anon.name), anon.length);
    const def = vm.runInNewContext('(function g(a,b=1,...r){})');
    console.log('default', JSON.stringify(def.name), def.length);
  `,
  expected: 'named "foo" 3 7\narrow "" 2\nanon "" 0\ndefault "g" 1\n',
};

export default c;
