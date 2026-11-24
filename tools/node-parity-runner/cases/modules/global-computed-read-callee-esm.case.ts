import type { ParityCase } from '../../src/types.ts';

// ESM twin of global-computed-read-callee-cjs (unit runtime-js/computed-global-read-callee).
const c: ParityCase = {
  kind: 'esm',
  setup: {
    files: {
      'dep.mjs': "export const value = 'computed-read-import';\n",
    },
  },
  code: `
    const out = [];
    const log = [];
    const names = ['Uint8Array', 'Float64Array'];
    function isDetached(buf) {
      try { new globalThis[names[0]](buf); } catch (e) { return !!e && e.name === 'TypeError'; }
      return false;
    }
    const gone = new ArrayBuffer(8);
    gone.transfer();
    out.push(['detached', isDetached(new ArrayBuffer(0)), isDetached(gone)]);
    out.push(['lengths', names.map((n) => new global[n](2).length)]);
    const g = globalThis;
    out.push(['alias', new g[names[1]](3).length]);
    let k = 'String';
    out.push(['call', globalThis[k](1), global[k].call(null, 2), globalThis[k].apply(null, [3]), globalThis[k].bind(null, 4)()]);
    globalThis.__riftyParityThis__ = function () { 'use strict'; return this === globalThis; };
    k = '__riftyParityThis__';
    out.push(['this', globalThis[k](), global[k]?.()]);
    delete globalThis.__riftyParityThis__;
    out.push(['optional', globalThis['__riftyParityMissing__' + k.length]?.()]);
    const key = { toString() { log.push('key'); return 'Uint8Array'; } };
    const arg = (v) => (log.push('arg'), v);
    const primitive = { [Symbol.toPrimitive](hint) { log.push(hint); return 'String'; } };
    out.push(['objectKey', new globalThis[key](arg(2)).length, globalThis[primitive](arg(5)), log.join(',')]);
    out.push(['await', new globalThis[await names[1]](1).length]);
    try { new globalThis[k + 'x'](); } catch (e) { out.push(['notConstructor', e.name]); }
    const F = 'Function';
    out.push(['fn', new globalThis[F]('a', 'return a + 1')(1), global[F]('return 2')(), globalThis[F].call(null, 'return 3')(), new globalThis[{ toString: () => F }]('return 4')()]);
    const m = await new globalThis[F]('return import("./dep.mjs")')();
    out.push(['fnImport', m.value]);
    console.log(JSON.stringify(out));
  `,
};

export default c;
