import type { ParityCase } from '../../src/types.ts';

// T8 deep-mutation probe (carried concern from T7). Captures REAL-Node behavior
// for two reconciliation edges — DO NOT hardcode guesses; the parity runner
// diffs against real Node and the `expected` below is what Node actually emits.
//   (1) guest MUTATES a property of a pre-existing shared host object, host reads
//       after the run,
//   (2) host MUTATES the sandbox BETWEEN two runs, the second run reads it.
const c: ParityCase = {
  code: `
    globalThis.__RIFTY_VM_ENGINE = 'quickjs';
    const vm = require('node:vm');

    // (1) guest mutates a property of a pre-existing shared host object.
    const shared = { count: 1 };
    const sb = { shared };
    vm.createContext(sb);
    vm.runInContext('shared.count = shared.count + 41', sb);
    console.log(sb.shared.count, sb.shared === shared);

    // (2) host mutates the sandbox between two runs; second run reads it.
    const sb2 = { v: 1 };
    vm.createContext(sb2);
    vm.runInContext('globalThis.__seenFirst = v', sb2);
    sb2.v = 2;
    console.log(vm.runInContext('v', sb2));
    console.log(vm.runInContext('__seenFirst', sb2));
  `,
  // Real-Node output (captured via the parity runner, NOT guessed):
  //   '42 true'  — (1) host sees the deep mutation; `sb.shared === shared` (live).
  //   '2'        — (2) second run sees the host-updated `v` (between-run re-sync).
  //   '1'        — `__seenFirst` captured `v` DURING the first run (then = 1) and
  //                stays 1 (the host's later `sb2.v = 2` does not retro-change it).
  expected: '42 true\n2\n1\n',
};

export default c;
