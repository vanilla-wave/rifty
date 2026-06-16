import type { ParityCase } from '../../src/types.ts';

// T19 — realistic corpus: "compute returns structured data". A pure computation
// in a fresh context returns arrays/objects/a Date; the host consumes them with
// Object.keys / JSON / Array.prototype.map / Date methods across the membrane.
// Mirrors a sandboxed rule/transform that hands structured results back to the
// host. Default (quickjs) engine; Node is the byte-for-byte oracle.
const c: ParityCase = {
  code: `
    const vm = require('node:vm');
    const out = vm.runInNewContext(
      'const rows = [1, 2, 3].map(function (n) { return { n: n, sq: n * n }; });' +
        '({ rows: rows, total: rows.reduce(function (a, r) { return a + r.sq; }, 0),' +
        ' when: new Date(0), meta: { ok: true } });',
    );
    console.log(Object.keys(out).sort().join(','));
    console.log(out.rows.map(function (r) { return r.n + '^2=' + r.sq; }).join(' '));
    console.log(out.total);
    console.log(out.when instanceof Date, out.when.toISOString());
    console.log(JSON.stringify(out.meta));
  `,
};

export default c;
