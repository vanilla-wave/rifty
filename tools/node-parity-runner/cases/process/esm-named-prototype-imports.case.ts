import type { ParityCase } from '../../src/types.ts';

/**
 * ESM named imports of `node:process` prototype methods (I6): rifty's
 * `NodeProcess` is class-backed, so its methods are non-enumerable prototype
 * members — the static name authority must collect the direct prototype.
 * Node's own boundary EXCLUDES EventEmitter methods (`on`/`emit`/`once` live
 * on `EventEmitter.prototype` and are not named exports in real Node).
 * No ambient `process` global reads — the in-process harness's global is the
 * HOST process (traps.md parity-runner-in-process). `expected` pinned from
 * Node v24.16.0.
 */
const c: ParityCase = {
  kind: 'esm',
  expected: [
    'string function',
    'function function function',
    'false false false true',
    'true',
    'true',
    'true',
  ].join('\n'),
  code: `
    import * as ns from 'node:process';
    import { cwd, nextTick, hrtime, uptime } from 'node:process';
    import { createRequire } from 'node:module';
    const req = createRequire(import.meta.url);
    console.log(typeof cwd(), typeof cwd);
    console.log(typeof nextTick, typeof hrtime, typeof uptime);
    console.log('on' in ns, 'emit' in ns, 'once' in ns, 'cwd' in ns);
    console.log(ns.cwd === cwd);
    console.log(req('node:process').cwd === cwd);
    console.log(req('node:process') === ns.default);
  `,
};

export default c;
