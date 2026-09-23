import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  kind: 'esm',
  code: `
    export const key = Symbol.for('rifty.parity.global-symbol.exported');
    globalThis[key] = 7;
    console.log(JSON.stringify({ value: globalThis[key] }));
    Reflect.deleteProperty(globalThis, key);
  `,
};

export default c;
