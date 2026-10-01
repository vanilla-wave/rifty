import type { ParityCase } from '../../src/types.ts';

/**
 * CJS twin of symbol-key-global-write-esm (I6): the undici shape
 * (`Object.defineProperty` with a const Symbol.for alias AND with a direct
 * `Symbol.for(...)` key — the alias variant cannot discriminate a
 * direct-key-only regression), a const-alias write/read-back, and the
 * Reflect.set / Object.assign / Object.defineProperties mutation-call
 * surfaces through `cjs.ts`'s guard. Every key the case sets is deleted at
 * the end so the in-process harness global stays clean. `expected` pinned
 * from Node v24.16.0.
 */
const c: ParityCase = {
  expected: ['cjs-ok dp', 'direct rs as ps', 'undefined undefined undefined'].join('\n'),
  code: `
    const D = Symbol.for('undici.globalDispatcher.2');
    Object.defineProperty(globalThis, D, { value: 'dp', configurable: true });
    Object.defineProperty(globalThis, Symbol.for('cjs.direct'), { value: 'direct', configurable: true });
    const K = Symbol.for('cjs.stash');
    globalThis[K] = 'cjs-ok';
    const R = Symbol.for('cjs.reflect');
    Reflect.set(globalThis, R, 'rs');
    const A = Symbol.for('cjs.assign');
    Object.assign(globalThis, { [A]: 'as' });
    const P = Symbol.for('cjs.props');
    Object.defineProperties(globalThis, { [P]: { value: 'ps', configurable: true } });
    console.log(globalThis[K], globalThis[D]);
    console.log(globalThis[Symbol.for('cjs.direct')], globalThis[R], globalThis[A], globalThis[P]);
    delete globalThis[D]; delete globalThis[K]; delete globalThis[R];
    delete globalThis[Symbol.for('cjs.direct')]; delete globalThis[A]; delete globalThis[P];
    console.log(typeof globalThis[D], typeof globalThis[K], typeof globalThis[R]);
  `,
};

export default c;
