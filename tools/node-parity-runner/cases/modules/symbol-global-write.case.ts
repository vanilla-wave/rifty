import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  kind: 'esm',
  code: `
    const timers = Symbol.for('rifty.parity.timers');
    globalThis[timers] = { value: 7 };
    Object.defineProperty(globalThis, Symbol.for('rifty.parity.dispatcher'), { value: 9, configurable: true });
    console.log(globalThis[timers].value, globalThis[Symbol.for('rifty.parity.dispatcher')]);
    delete globalThis[timers];
    delete globalThis[Symbol.for('rifty.parity.dispatcher')];
  `,
};

export default c;
