import type { ParityCase } from '../../src/types.ts';

// T10 — Symbol marshalling both directions. Node is the oracle.
// Cross-realm truth (verified via real `node`):
//   - a UNIQUE guest symbol → host symbol with the same `.description`, NOT `===`
//     any host symbol (fresh, identity-cached so the SAME guest symbol round-trips
//     to the SAME host symbol);
//   - WELL-KNOWN symbols are SHARED across realms: `Symbol.iterator` OUT
//     `=== host Symbol.iterator`;
//   - REGISTRY symbols (`Symbol.for(k)`) are SHARED: OUT `=== host Symbol.for(k)`;
//   - symbol-keyed OWN props are surfaced by `Object.getOwnPropertySymbols` and
//     readable; a guest object keyed by `Symbol.iterator` is iterable in the host;
//   - host symbols seeded IN keep `typeof`/`.description`; well-known/registry are
//     shared with the guest; a host symbol round-trips back to the SAME host
//     symbol (`=== hostSym`).
const c: ParityCase = {
  code: `
    const vm = require('node:vm');
    const s = vm.runInNewContext('Symbol("x")');
    console.log('uniq', typeof s, JSON.stringify(s.description), s.toString());
    const it = vm.runInNewContext('Symbol.iterator');
    console.log('wk', it === Symbol.iterator, it.toString());
    const reg = vm.runInNewContext('Symbol.for("shared")');
    console.log('reg', reg === Symbol.for('shared'), JSON.stringify(reg.description));
    const obj = vm.runInNewContext('({ [Symbol("k")]: 42, normal: 1 })');
    const syms = Object.getOwnPropertySymbols(obj);
    console.log('symkeys', syms.length, JSON.stringify(syms[0].description), obj[syms[0]], obj.normal);
    const iterable = vm.runInNewContext('({ [Symbol.iterator]() { let i=0; return { next: () => i<3 ? {value:i++,done:false} : {value:undefined,done:true} }; } })');
    console.log('iter', JSON.stringify([...iterable]));
    const hostSym = Symbol('hs');
    let back;
    const ctx = vm.createContext({ s: hostSym, wk: Symbol.iterator, reg: Symbol.for('R'), check: (x) => { back = x; } });
    const r2 = vm.runInContext("[typeof s, s.description, wk === Symbol.iterator, reg === Symbol.for('R')].join(',')", ctx);
    console.log('IN', r2);
    vm.runInContext('check(s)', ctx);
    console.log('roundtrip', back === hostSym);
  `,
  expected:
    'uniq symbol "x" Symbol(x)\n' +
    'wk true Symbol(Symbol.iterator)\n' +
    'reg true "shared"\n' +
    'symkeys 1 "k" 42 1\n' +
    'iter [0,1,2]\n' +
    'IN symbol,hs,true,true\n' +
    'roundtrip true\n',
};

export default c;
