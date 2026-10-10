import type { ParityCase } from '../../src/types.ts';

// runtime-js/symbol-key-global-write-guard-precision (CJS side): undici's
// global.js does `Object.defineProperty(globalThis, globalDispatcher /* Symbol */, …)`.
// Registry key is case-owned: a real undici loaded by net/http cases in the
// same in-process realm defines the production key non-configurable first.
const c: ParityCase = {
  code: `
    const globalDispatcher = Symbol.for('undici.globalDispatcher.case');
    Object.defineProperty(globalThis, globalDispatcher, {
      value: { dispatch() {} },
      writable: true,
      enumerable: true,
      configurable: false,
    });
    console.log(typeof globalThis[globalDispatcher].dispatch);
  `,
};

export default c;
