import type { ParityCase } from '../../src/types.ts';

/** Pure ESM cycles stay live; a CJS back-edge is a directed cycle error. */
const c: ParityCase = {
  setup: {
    files: {
      'pure-a.mjs': `
        globalThis.__requireEsmCycleRuns.a += 1;
        import { b, readA } from './pure-b.mjs';
        export const a = 'A';
        export const seenB = b;
        export const through = readA();
      `,
      'pure-b.mjs': `
        globalThis.__requireEsmCycleRuns.b += 1;
        import { a } from './pure-a.mjs';
        export const b = 'B';
        export function readA() { return a; }
      `,
      'mixed-entry.mjs': `
        import './mixed-cjs.cjs';
        export const unreachable = true;
      `,
      'mixed-cjs.cjs': "module.exports = require('./mixed-entry.mjs');",
      'star-a.mjs': "export const a = 'A'; export * from './star-b.mjs';",
      'star-b.mjs': "export * from './star-a.mjs'; export const b = 'B';",
      'ambiguous-entry.mjs':
        "export * from './ambiguous-a.mjs'; export * from './ambiguous-b.mjs';",
      'ambiguous-a.mjs': "export const x = 'A';",
      'ambiguous-b.mjs': "export const x = 'B';",
      'shared-entry.mjs': "export * from './shared-a.mjs'; export * from './shared-b.mjs';",
      'shared-a.mjs': "export * from './shared-origin.mjs';",
      'shared-b.mjs': "export * from './shared-origin.mjs';",
      'shared-origin.mjs': "export const x = 'shared';",
      'alias-entry.mjs': "export * from './alias-a.mjs'; export * from './alias-b.mjs';",
      'alias-a.mjs': "import { x as shared } from './alias-origin.mjs'; export { shared };",
      'alias-b.mjs': "import { x as shared } from './alias-origin.mjs'; export { shared };",
      'alias-origin.mjs': 'export const x = 3;',
      'tdz-a.mjs': "import { b } from './tdz-b.mjs'; export const a = b;",
      'tdz-b.mjs': "import { a } from './tdz-a.mjs'; export const b = a;",
      'hoist-a.mjs': `
        import { called } from './hoist-b.mjs';
        export function value() { return 'A'; }
        export const seen = called;
      `,
      'hoist-b.mjs': `
        import { value } from './hoist-a.mjs';
        export const called = value();
      `,
      'var-a.mjs': `
        import { seen } from './var-b.mjs';
        export var value = 1;
        export const duringCycle = seen;
      `,
      'var-b.mjs': `
        import { value } from './var-a.mjs';
        export const seen = value;
      `,
      'cjs-prime-root.mjs': `
        import { called } from './cjs-prime-child.mjs';
        import value from './cjs-prime.cjs';
        export function read() { return value; }
        export const duringCycle = called;
      `,
      'cjs-prime-child.mjs': `
        import { read } from './cjs-prime-root.mjs';
        export const called = read();
      `,
      'cjs-prime.cjs': 'module.exports = 7;',
      'cjs-star.cjs': 'exports.x = 1;',
      'cjs-star-bridge.mjs': "export * from './cjs-star.cjs';",
      'cjs-star-entry.mjs': "import { x } from './cjs-star-bridge.mjs'; export { x };",
      'cjs-star-a.cjs': 'exports.x = 1;',
      'cjs-star-b.cjs': 'exports.x = 2;',
      'cjs-star-ambiguous.mjs': `
        export * from './cjs-star-a.cjs';
        export * from './cjs-star-b.cjs';
      `,
      'partial-entry.cjs': `
        globalThis.__requireEsmCycleRuns.partialEntry += 1;
        module.exports.phase = 'entry-before';
        const esm = require('./partial-esm.mjs');
        module.exports.phase = 'entry-after';
        module.exports.fromEsm = esm.fromCjs;
      `,
      'partial-esm.mjs': `
        globalThis.__requireEsmCycleRuns.partialEsm += 1;
        import cjs from './partial-cjs.cjs';
        export const fromCjs = 'esm:' + cjs.seen;
      `,
      'partial-cjs.cjs': `
        globalThis.__requireEsmCycleRuns.partialCjs += 1;
        const entry = require('./partial-entry.cjs');
        module.exports = { seen: entry.phase };
      `,
    },
  },
  code: `
    globalThis.__requireEsmCycleRuns = {
      a: 0,
      b: 0,
      partialEntry: 0,
      partialEsm: 0,
      partialCjs: 0,
    };
    const pure = require('./pure-a.mjs');
    const pureAgain = require('./pure-a.mjs');
    const starA = require('./star-a.mjs');
    const starB = require('./star-b.mjs');
    const ambiguous = require('./ambiguous-entry.mjs');
    const shared = require('./shared-entry.mjs');
    const aliased = require('./alias-entry.mjs');
    const hoisted = require('./hoist-a.mjs');
    const varCycle = require('./var-a.mjs');
    const cjsPrimed = require('./cjs-prime-root.mjs');
    const cjsStar = require('./cjs-star-entry.mjs');
    const cjsStarAmbiguous = require('./cjs-star-ambiguous.mjs');
    const partial = require('./partial-entry.cjs');
    let tdzError;
    try { require('./tdz-a.mjs'); }
    catch (caught) { tdzError = caught; }
    let error;
    try { require('./mixed-entry.mjs'); }
    catch (caught) { error = caught; }
    console.log(JSON.stringify({
      pure: [pure.a, pure.seenB, pure.through],
      pureIdentity: pureAgain === pure,
      star: [Object.keys(starA), Object.keys(starB), starB.a],
      starResolution: [Object.keys(ambiguous), Object.keys(shared), shared.x],
      aliasResolution: [Object.keys(aliased), aliased.shared],
      tdzName: tdzError && tdzError.name,
      initializedBindings: [hoisted.seen, varCycle.value, varCycle.duringCycle],
      primedCjsBinding: [cjsPrimed.duringCycle, cjsPrimed.read()],
      cjsStar: cjsStar.x,
      cjsStarAmbiguous: [Object.keys(cjsStarAmbiguous), cjsStarAmbiguous.x],
      partial: [partial.phase, partial.fromEsm],
      runs: globalThis.__requireEsmCycleRuns,
      code: error && error.code,
      name: error && error.name,
    }));
  `,
  expected:
    '{"pure":["A","B","A"],"pureIdentity":true,"star":[["a","b"],["a","b"],"A"],"starResolution":[[],["x"],"shared"],"aliasResolution":[["shared"],3],"tdzName":"ReferenceError","initializedBindings":["A",1,null],"primedCjsBinding":[null,7],"cjsStar":1,"cjsStarAmbiguous":[[],null],"partial":["entry-after","esm:entry-before"],"runs":{"a":1,"b":1,"partialEntry":1,"partialEsm":1,"partialCjs":1},"code":"ERR_REQUIRE_CYCLE_MODULE","name":"Error"}\n',
};

export default c;
