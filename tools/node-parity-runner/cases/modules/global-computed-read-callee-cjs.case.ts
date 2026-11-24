import type { ParityCase } from '../../src/types.ts';

// Unit runtime-js/computed-global-read-callee: a computed read of a global member
// called or constructed. es-abstract 2025/IsDetachedBuffer.js:22 and
// typed-array-length index.js:41 shapes, call forms, key coercion. A key that is
// 'Function' at runtime is a declared ceiling (conformance global-computed-read-callee).
const c: ParityCase = {
  code: `
    const out = [];
    const log = [];
    const names = ['Uint8Array', 'Float64Array'];
    function isDetached(buf) {
      try { new global[names[0]](buf); } catch (e) { return !!e && e.name === 'TypeError'; }
      return false;
    }
    const gone = new ArrayBuffer(8);
    gone.transfer();
    out.push(['detached', isDetached(new ArrayBuffer(0)), isDetached(gone)]);
    out.push(['lengths', names.map((n) => new global[n](2).length)]);
    const g = globalThis;
    out.push(['alias', new g[names[1]](3).length]);
    let k = 'String';
    out.push(['call', global[k](1), globalThis[k].call(null, 2), global[k].apply(null, [3]), global[k].bind(null, 4)()]);
    globalThis.__riftyParityThis__ = function () { 'use strict'; return this === globalThis; };
    k = '__riftyParityThis__';
    out.push(['this', global[k](), globalThis[k]?.()]);
    delete globalThis.__riftyParityThis__;
    out.push(['optional', global['__riftyParityMissing__' + k.length]?.()]);
    const key = { toString() { log.push('key'); return 'Uint8Array'; } };
    const arg = (v) => (log.push('arg'), v);
    const primitive = { [Symbol.toPrimitive](hint) { log.push(hint); return 'String'; } };
    out.push(['objectKey', new global[key](arg(2)).length, global[primitive](arg(5)), log.join(',')]);
    out.push(['nested', new global[(log.length, names)[1]](1).length, new globalThis[\`\${names[0]}\`](1).length]);
    try { new global[k + 'x'](); } catch (e) { out.push(['notConstructor', e.name]); }
    console.log(JSON.stringify(out));
  `,
};

export default c;
