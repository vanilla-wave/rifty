import type { ParityCase } from '../../src/types.ts';

/**
 * `util.format('%s', v)` picks Node's branch (`formatWithOptionsInternal`): a number via
 * `formatNumber` (`-0`), a bigint `<n>n`, a non-object or an object without a built-in
 * `toString` (`hasBuiltInToString`) via `String()`, else `inspect` at depth 0. Rows whose
 * inspect text itself differs (`backlog/runtime-js/inspect-null-prototype-prefix`) stay out.
 */
const c: ParityCase = {
  code: `
    const util = require('node:util');
    const { Buffer } = require('node:buffer');
    const row = (label, f) => {
      let r;
      try { r = JSON.stringify(f()); } catch (e) { r = 'throw ' + e.name + ': ' + e.message; }
      console.log(label + ' -> ' + r);
    };
    const s = (v) => () => util.format('%s', v);
    class A { toString() { return 'A'; } }
    class B extends A {}
    class P { [Symbol.toPrimitive]() { return 'P'; } }
    class Q {}
    row('own toString', s({ toString() { return 'o'; } }));
    row('class toString', s(new A()));
    row('subclass toString', s(new B()));
    row('inherited user toString', s(Object.create({ toString() { return 'inh'; } })));
    row('own toPrimitive', s({ [Symbol.toPrimitive]: () => 'p' }));
    row('class toPrimitive', s(new P()));
    row('toPrimitive throws', s({ [Symbol.toPrimitive]() { throw new Error('PRIM'); } }));
    row('toString throws', s({ toString() { throw new Error('TS'); } }));
    row('toString not a function', s({ toString: 1 }));
    row('null proto own toString', s(Object.assign(Object.create(null), { toString() { return 'np'; } })));
    row('transparent proxy toString', s(new Proxy({ toString() { return 'px'; } }, {})));
    row('transparent proxy plain', s(new Proxy({ a: 1 }, {})));
    row('transparent proxy toString not a function', s(new Proxy({ toString: 1 }, {})));
    row('transparent proxy null proto own toString', s(new Proxy(Object.assign(Object.create(null), { toString() { return 'np'; } }), {})));
    for (const n of [-0, 0, 1.5, NaN, -Infinity, 1e21]) row('number ' + Object.is(n, -0), s(n));
    for (const v of [10n, -10n, 'str', Symbol('sy'), null, undefined, true]) row(typeof v, s(v));
    row('function', s(function f() { return 1; }));
    row('class', s(class K {}));
    row('plain', s({ a: 1, b: 'x', c: { d: 1 } }));
    row('array', s([1, [2, [3]]]));
    row('class without toString', s(new Q()));
    row('Date', s(new Date(0)));
    row('RegExp', s(/a/g));
    row('Map', s(new Map([[1, 2]])));
    row('Set', s(new Set([1])));
    row('Uint8Array', s(new Uint8Array([1, 2])));
    row('Buffer', s(Buffer.from('ab')));
    row('Error', s(Object.assign(new Error('m'), { stack: 'Error: m\\n    at x' })));
    row('no argument', () => util.format('x %s y'));
    row('two %s one argument', () => util.format('%s:%s', 'a'));
    // Node reads its primordials: a guest's replacements do not change the branch.
    const has = Set.prototype.has, is = Object.is;
    let patched;
    try {
      Set.prototype.has = () => true;
      Object.is = () => false;
      patched = [util.format('%s', new A()), util.format('%s', -0)];
    } finally {
      Set.prototype.has = has;
      Object.is = is;
    }
    row('patched Set.prototype.has, Object.is', () => patched.join(' '));
    row('formatWithOptions depth', () => util.formatWithOptions({ depth: 5 }, '%s', { a: { b: 1 } }));
    // Built-in = a constructor name Node's inspect.js saw on globalThis at load (V8's own
    // globals, not Buffer/URL): a user class so named and with its own toString is inspected.
    const re = /^[A-Z][a-zA-Z0-9]+$/;
    const names = [...Object.getOwnPropertyNames(globalThis), 'Document', 'HTMLElement', 'Window', 'Worker'];
    const inspected = names.filter((n) => re.test(n)).filter((n) => {
      const C = { [n]: class { toString() { return 'S'; } } }[n];
      return util.format('%s', new C()) !== 'S';
    });
    console.log('built-in names ' + inspected.join(' '));
  `,
};

export default c;
