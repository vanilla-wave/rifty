import type { ParityCase } from '../../src/types.ts';

// T6 — membrane identity cache + nested guest→host marshalling.
// The SAME guest object returned across two runs must yield the SAME host
// wrapper (`a === b`), matching real Node (which hands back the genuine guest
// object both times). Also exercises recursive object/array marshalling and the
// cross-realm array identity (`Array.isArray` TRUE, `instanceof Array` FALSE).
const c: ParityCase = {
  code: `
    const vm = require('node:vm');
    const ctx = vm.createContext({});
    vm.runInContext('globalThis.shared = {x:1}; globalThis.getShared = () => shared;', ctx);
    const a = vm.runInContext('getShared()', ctx);
    const b = vm.runInContext('getShared()', ctx);
    console.log(a === b, a.x);
    const nested = vm.runInContext('({list:[1,2,{deep:9}], name:"hi"})', ctx);
    console.log(JSON.stringify(nested), nested.list[2].deep, Array.isArray(nested.list), nested.list instanceof Array);
  `,
  expected: 'true 1\n{"list":[1,2,{"deep":9}],"name":"hi"} 9 true false\n',
};

export default c;
