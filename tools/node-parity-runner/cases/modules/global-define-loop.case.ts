import type { ParityCase } from '../../src/types.ts';
const c: ParityCase = {
  kind: 'esm',
  code: `
    function setup(defines) { for (const key in defines) globalThis[key] = defines[key]; }
    setup({}); setup({ __riftyParityDefine:42 }); console.log(globalThis.__riftyParityDefine);
    const events = []; const key = { [Symbol.toPrimitive](hint) { events.push(hint); return '__riftyParityDefine'; } };
    globalThis[key] = (events.push('rhs'), 43); console.log(events.join(','), globalThis.__riftyParityDefine); delete globalThis.__riftyParityDefine;
  `,
};
export default c;
