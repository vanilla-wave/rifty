import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  kind: 'esm',
  code: `
    const safe = Symbol.for('rifty.parity.global-symbol.esm');
    const descriptor = Symbol('descriptor');
    const reflected = Symbol.for('rifty.parity.global-symbol.esm.reflect');
    try {
      globalThis[safe] = 7;
      Object.defineProperty(globalThis, descriptor, { value: 8, configurable: true });
      Reflect.set(globalThis, Symbol.for('rifty.parity.global-symbol.esm.reflect'), 9);
      console.log(JSON.stringify({
        values: [globalThis[safe], globalThis[descriptor], globalThis[reflected]],
        descriptor: Object.getOwnPropertyDescriptor(globalThis, descriptor)?.configurable,
      }));
    } finally {
      Reflect.deleteProperty(globalThis, safe);
      Reflect.deleteProperty(globalThis, descriptor);
      Reflect.deleteProperty(globalThis, reflected);
    }
  `,
};

export default c;
