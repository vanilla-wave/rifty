import type { ParityCase } from '../../src/types.ts';

// T10 — exotic-type mirroring across the membrane (Date / RegExp / TypedArray),
// both directions. Node is the oracle (runner diffs byte-for-byte).
//
// Cross-realm truth (verified via real `node`):
//   OUT (guest→host): a guest exotic returned to the host is `typeof 'object'`,
//     `instanceof hostCtor` FALSE (cross-realm proto), but its brand
//     (`Object.prototype.toString.call`) is correct, its methods work
//     (`getTime`/`toISOString`/`test`), `source`/`flags` read, indexing +
//     `Array.from` + `.length` work for typed arrays, `ArrayBuffer.isView` TRUE,
//     and JSON serialises like the real exotic.
//   IN (host→guest): symmetric — a host exotic seeded into the guest is
//     `instanceof guestCtor` FALSE but brand/methods/data all faithful.
const c: ParityCase = {
  code: `
    const vm = require('node:vm');
    // --- OUT ---
    const d = vm.runInNewContext('new Date(0)');
    console.log('date', typeof d, d instanceof Date, d.getTime(), d.toISOString(), Object.prototype.toString.call(d), JSON.stringify(d));
    const r = vm.runInNewContext('/ab+/gi');
    console.log('regexp', typeof r, r instanceof RegExp, r.source, r.flags, r.test('ABB'), r.toString(), Object.prototype.toString.call(r));
    const u = vm.runInNewContext('new Uint8Array([1,2,3])');
    console.log('u8', typeof u, u instanceof Uint8Array, u.length, u[0], u[1], u[2], JSON.stringify(Array.from(u)), Object.prototype.toString.call(u), ArrayBuffer.isView(u));
    const f = vm.runInNewContext('new Float64Array([1.5,2.5])');
    console.log('f64', f instanceof Float64Array, f.length, f[0], f[1], JSON.stringify(Array.from(f)), Object.prototype.toString.call(f));
    // --- IN ---
    const ctx = vm.createContext({ hd: new Date(1000), hr: /xy*/m, hu: new Uint8Array([7,8,9]) });
    const res = vm.runInContext([
      'typeof hd', 'hd instanceof Date', 'hd.getTime()', 'hd.toISOString()', 'Object.prototype.toString.call(hd)',
      'typeof hr', 'hr instanceof RegExp', 'hr.source', 'hr.flags', 'Object.prototype.toString.call(hr)',
      'typeof hu', 'hu instanceof Uint8Array', 'hu.length', 'hu[0]', 'hu[1]', 'hu[2]', 'JSON.stringify(Array.from(hu))', 'Object.prototype.toString.call(hu)', 'ArrayBuffer.isView(hu)'
    ].map(e => '(' + e + ')').join(" + ' | ' + "), ctx);
    console.log('IN', res);
  `,
  expected:
    'date object false 0 1970-01-01T00:00:00.000Z [object Date] "1970-01-01T00:00:00.000Z"\n' +
    'regexp object false ab+ gi true /ab+/gi [object RegExp]\n' +
    'u8 object false 3 1 2 3 [1,2,3] [object Uint8Array] true\n' +
    'f64 false 2 1.5 2.5 [1.5,2.5] [object Float64Array]\n' +
    'IN object | false | 1000 | 1970-01-01T00:00:01.000Z | [object Date] | object | false | xy* | m | [object RegExp] | object | false | 3 | 7 | 8 | 9 | [7,8,9] | [object Uint8Array] | true\n',
};

export default c;
