import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const safe = Symbol.for('rifty.parity.global-symbol.cjs');
    const descriptor = Symbol.for('rifty.parity.global-symbol.cjs.descriptor');
    const reflected = Symbol('reflected');
    try {
      globalThis[safe] = 7;
      Object.defineProperty(globalThis, Symbol.for('rifty.parity.global-symbol.cjs.descriptor'), { value: 8, configurable: true });
      Reflect.set(globalThis, reflected, 9);
      console.log(JSON.stringify({
        values: [globalThis[safe], globalThis[descriptor], globalThis[reflected]],
        descriptor: Object.getOwnPropertyDescriptor(globalThis, descriptor)?.configurable,
        stringFunctionUntouched: typeof globalThis.Function === 'function',
      }));
    } finally {
      Reflect.deleteProperty(globalThis, safe);
      Reflect.deleteProperty(globalThis, descriptor);
      Reflect.deleteProperty(globalThis, reflected);
    }
  `,
};

export default c;
