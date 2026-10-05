import type { ParityCase } from '../../src/types.ts';

/**
 * Provably-Symbol computed keys on globalThis are never the string
 * 'Function' (I6): the @vitest/utils shape (`const SAFE = Symbol.for(…)`;
 * write, read-back, method call through the stash) and the undici shape
 * (`Object.defineProperty(globalThis, Symbol.for(…), …)`) must compile and
 * run — rifty's Function-assignment ceiling governs only keys that MAY be
 * 'Function'. Every key the case sets is deleted at the end so the
 * in-process harness global stays clean. `expected` pinned from Node
 * v24.16.0.
 */
const c: ParityCase = {
  kind: 'esm',
  expected: ['stash pong', 'dp', '42', 'undefined undefined undefined'].join('\n'),
  code: `
    const SAFE = Symbol.for('vitest:utils:SAFE_TIMERS');
    globalThis[SAFE] = { tag: 'stash', ping() { return 'pong'; } };
    const readBack = globalThis[SAFE];
    console.log(readBack.tag, globalThis[SAFE].ping());
    Object.defineProperty(globalThis, Symbol.for('undici.globalDispatcher.2'), { value: 'dp', configurable: true });
    console.log(globalThis[Symbol.for('undici.globalDispatcher.2')]);
    const direct = Symbol('local');
    globalThis[direct] = 42;
    console.log(globalThis[direct]);
    delete globalThis[SAFE];
    delete globalThis[Symbol.for('undici.globalDispatcher.2')];
    delete globalThis[direct];
    console.log(typeof globalThis[SAFE], typeof globalThis[Symbol.for('undici.globalDispatcher.2')], typeof globalThis[direct]);
  `,
};

export default c;
