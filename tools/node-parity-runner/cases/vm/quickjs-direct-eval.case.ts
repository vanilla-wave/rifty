import type { ParityCase } from '../../src/types.ts';

// T11 — direct `eval` inside the guest stays in the guest realm (FALSIFIES the
// ADR-0138 premise that direct eval leaks to the host). Node oracle: the host
// `globalThis.leaked` is never defined; the guest's `leaked` global is observable
// only via the contextObject (`sb.leaked`). Captured `undefined 1` via real Node.
const c: ParityCase = {
  code: `
    const vm = require('node:vm');
    const sb = {}; vm.createContext(sb);
    vm.runInContext('eval("leaked = 1")', sb);
    console.log(typeof globalThis.leaked, sb.leaked);
  `,
  expected: 'undefined 1\n',
};

export default c;
