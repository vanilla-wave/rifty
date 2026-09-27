import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  kind: 'esm',
  code: `
    const key = Symbol('Function');
    const registered = Symbol.for('rifty.parity.symbol-writes.esm');
    globalThis[key] = 1;
    console.log('assign', globalThis[key]);
    globalThis[key] += 2;
    console.log('update', ++globalThis[key]);
    Object.defineProperty(globalThis, registered, { value: 5, configurable: true });
    console.log('define', globalThis[registered]);
    Object.defineProperties(globalThis, { [key]: { value: 6, configurable: true } });
    console.log('descriptors', globalThis[key]);
    Reflect.defineProperty(globalThis, key, { value: 7 });
    Reflect.set(globalThis, key, 8);
    console.log('reflect', globalThis[key]);
    Object.assign(globalThis, { [key]: 9 });
    console.log('object', globalThis[key]);
    globalThis.__defineGetter__(registered, () => 10);
    console.log('getter', globalThis[registered]);
    Object.defineProperty(globalThis, Symbol.for('rifty.parity.symbol-inline.esm'), { value: 11, configurable: true });
    console.log('inline', globalThis[Symbol.for('rifty.parity.symbol-inline.esm')]);
    const trace = [];
    const dynamicKey = Symbol('dynamic');
    function nextKey() { trace.push('key'); return dynamicKey; }
    globalThis[nextKey()] = (trace.push('value'), 12);
    console.log('order', trace.join(','), globalThis[dynamicKey]);
    delete globalThis[dynamicKey];
    let mutable = Symbol('mutable');
    globalThis[mutable] = 13;
    console.log('mutable', globalThis[mutable]);
    delete globalThis[mutable];
    function shadow(Symbol) {
      const local = Symbol('local');
      globalThis[local] = 14;
      console.log('shadow', globalThis[local]);
      delete globalThis[local];
    }
    shadow(globalThis.Symbol);
    console.log('delete', delete globalThis[key], Reflect.deleteProperty(globalThis, registered));
    Reflect.deleteProperty(globalThis, Symbol.for('rifty.parity.symbol-inline.esm'));
  `,
  expected:
    'assign 1\nupdate 4\ndefine 5\ndescriptors 6\nreflect 8\nobject 9\ngetter 10\ninline 11\norder key,value 12\nmutable 13\nshadow 14\ndelete true true\n',
};

export default c;
