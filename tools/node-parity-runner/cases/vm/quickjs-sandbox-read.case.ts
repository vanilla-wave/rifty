import type { ParityCase } from '../../src/types.ts';

// T7 — host→guest membrane: share the LIVE contextObject INTO the guest realm
// (read path). Node is the oracle (parity runner diffs against real Node).
//   - host array seen in guest: `instanceof Array` FALSE (its proto is not the
//     guest Array.prototype) but `Array.isArray` TRUE (cross-realm brand check),
//   - length / number / string read correctly,
//   - round-trip identity: a host object marshalled IN then returned OUT is the
//     SAME host object (reference identity via the bidirectional identity cache).
const c: ParityCase = {
  code: `
    const vm = require('node:vm');
    const hostArr = [1,2,3];
    const ctx = vm.createContext({ hostArr, num: 7, str: 'hi' });
    console.log(vm.runInContext('hostArr instanceof Array', ctx));
    console.log(vm.runInContext('Array.isArray(hostArr)', ctx));
    console.log(vm.runInContext('hostArr.length + num', ctx));
    console.log(vm.runInContext('str', ctx));
    console.log(vm.runInContext('hostArr', ctx) === hostArr);
  `,
  expected: 'false\ntrue\n10\nhi\ntrue\n',
};

export default c;
