import type { ParityCase } from '../../src/types.ts';

/**
 * CJS twin of symbol-key-global-write-esm (I6): the undici shape
 * (`Object.defineProperty(globalThis, <const Symbol.for alias>, …)`) and a
 * const-alias write/read-back through `cjs.ts`'s guard. Keys are deleted at
 * the end so the in-process harness global stays clean. `expected` pinned
 * from Node v24.16.0.
 */
const c: ParityCase = {
  expected: ['cjs-ok dp', 'undefined'].join('\n'),
  code: `
    const D = Symbol.for('undici.globalDispatcher.2');
    Object.defineProperty(globalThis, D, { value: 'dp', configurable: true });
    const K = Symbol.for('cjs.stash');
    globalThis[K] = 'cjs-ok';
    console.log(globalThis[K], globalThis[D]);
    delete globalThis[D];
    console.log(typeof globalThis[D]);
  `,
};

export default c;
