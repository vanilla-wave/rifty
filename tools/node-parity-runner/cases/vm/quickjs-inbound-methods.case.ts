import type { ParityCase } from '../../src/types.ts';

// T19 regression — host→guest inbound prototype-method fidelity. A host array /
// object seeded into a context must carry its PROTOTYPE METHODS in the guest
// (`arr.map`/`join`/`hasOwnProperty`, `obj.hasOwnProperty`) while staying
// `instanceof Array`/`Object` FALSE (cross-realm proto) and `Array.isArray` TRUE.
// The membrane previously severed the seed proto to `null`, which kept the
// `instanceof`-FALSE half but STRIPPED every inherited method (`typeof items.join`
// was 'undefined'); calling such a method threw `not a function`. Node is the
// byte-for-byte oracle. Default (quickjs) engine.
const c: ParityCase = {
  code: `
    const vm = require('node:vm');
    const ctx = vm.createContext({ items: ['x', 'y', 'z'], obj: { a: 1, b: 2 } });
    const p = (label, src) => {
      try { console.log(label, JSON.stringify(vm.runInContext(src, ctx))); }
      catch (e) { console.log(label, 'THROW', e.constructor.name); }
    };
    p('join', 'items.join("-")');
    p('map', 'items.map(function (i) { return i.toUpperCase(); }).join(",")');
    p('filter', 'items.filter(function (i) { return i !== "y"; }).length');
    p('typeof-join', 'typeof items.join');
    p('isArray', 'Array.isArray(items)');
    p('instanceof', 'items instanceof Array');
    p('spread', 'JSON.stringify([...items])');
    p('arr-hasOwn', 'items.hasOwnProperty(0)');
    p('arr-valueOf', 'typeof items.valueOf');
    p('obj-hasOwn', 'obj.hasOwnProperty("a")');
    p('obj-instanceof', 'obj instanceof Object');
    p('obj-keys', 'JSON.stringify(Object.keys(obj))');
    p('obj-entries', 'JSON.stringify(Object.entries(obj))');
    p('obj-toString', 'Object.prototype.toString.call(obj)');
  `,
};

export default c;
