import type { ParityCase } from '../../src/types.ts';

// T8 — post-run sweep + write-back: guest writes reconciled back to the host
// contextObject so guest assignments to globals AND to seeded nested objects are
// visible to the host. Node is the oracle (parity runner diffs against real Node).
//   - write to a SEEDED nested object (`module.exports = {...}`) → host
//     `sb.module.exports.built` === true (nested write-back),
//   - that written object read from the host is a GUEST-realm object →
//     `instanceof Object` FALSE (membrane-wrapped, cross-realm proto break),
//   - `this.shared = {tag:1}; this.shared` returns a value `=== sb2.shared`
//     (SAME identity via the membrane identity cache) and `.tag === 1`,
//   - a guest-INVENTED global (`newGlobal = 99`) → host `sb2.newGlobal === 99`.
const c: ParityCase = {
  code: `
    const vm = require('node:vm');
    const sb = { module: { exports: null } };
    vm.createContext(sb);
    vm.runInContext('module.exports = { built: true }', sb);
    console.log(sb.module.exports.built, sb.module.exports instanceof Object);
    const sb2 = {}; vm.createContext(sb2);
    const ret = vm.runInContext('this.shared = {tag:1}; this.shared', sb2);
    console.log(ret === sb2.shared, sb2.shared.tag);
    vm.runInContext('newGlobal = 99', sb2);
    console.log(sb2.newGlobal);
  `,
  expected: 'true false\ntrue 1\n99\n',
};

export default c;
