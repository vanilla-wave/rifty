import type { ParityCase } from '../../src/types.ts';

// runtime-js/symbol-key-global-write-guard-precision (CJS side): undici's
// global.js does `Object.defineProperty(globalThis, globalDispatcher /* Symbol */, …)`.
const c: ParityCase = {
  code: `
    const globalDispatcher = Symbol.for('undici.globalDispatcher.1');
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