import type { ParityCase } from '../../src/types.ts';

// T8 review — the contextObject is LIVE: writes made BEFORE a throw ARE visible to
// the host (Node oracle, verified probe). The post-run sweep therefore runs in a
// `finally` so it executes on the THROW path too, not just the success path.
//   - `this.a = 1` / `globalThis.b = 5` (new globals before throw) → host sees them,
//   - `o.n = 99` (deep pre-throw mutation of a seeded nested object) → host sees it,
//   - the NEXT run reads the reconciled state (`a + b + o.n === 105`).
const c: ParityCase = {
  code: `
    const vm = require('node:vm');
    const sb = { o: { n: 1 } }; vm.createContext(sb);
    try { vm.runInContext('this.a = 1; globalThis.b = 5; o.n = 99; throw new Error("boom")', sb); } catch (e) {}
    console.log(sb.a, sb.b, sb.o.n);
    // next run still sees the reconciled state
    console.log(vm.runInContext('a + b + o.n', sb));
  `,
  expected: '1 5 99\n105\n',
};

export default c;
