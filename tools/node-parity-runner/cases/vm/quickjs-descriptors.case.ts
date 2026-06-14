import type { ParityCase } from '../../src/types.ts';

// T12 — descriptor fidelity + frozen + Proxy invariants + prototype/has coherence.
// Node is the oracle (runner diffs against real Node byte-for-byte). The OUT
// object wrapper must report the GUEST object's real descriptors and a coherent
// prototype/`has` view, and write-through host→guest mutations where Node allows.
//
// Cross-realm truth (verified via real `node`):
//   - frozen guest object → host `Object.isFrozen` TRUE, writes rejected (loose:
//     no-op false; strict: TypeError), descriptor configurable/writable FALSE.
//   - plain prop → {writable,enumerable,configurable} all TRUE.
//   - non-enumerable prop excluded from `Object.keys`, descriptor enumerable FALSE.
//   - prototype/has: `Object.getPrototypeOf(o)` is NOT host Object.prototype
//     (cross-realm), but `'toString' in o` is TRUE (walks the guest chain) and the
//     proto's proto is null; `o instanceof Object`/`o.constructor===Object` FALSE.
//   - accessor → descriptor exposes get/set fns (marshalled through the membrane).
//   - sealed → non-configurable but writable.
//   - write-through: host setting/overwriting/deleting a prop on a returned guest
//     object writes to the guest, and the guest sees it live.
const c: ParityCase = {
  code: `
    globalThis.__RIFTY_VM_ENGINE = 'quickjs';
    const vm = require('node:vm');
    const out = [];
    // frozen
    const fz = vm.runInNewContext('Object.freeze({x:1})');
    out.push('frozen ' + Object.isFrozen(fz) + ' ' + JSON.stringify(Object.getOwnPropertyDescriptor(fz, 'x')));
    let lw=false; try { fz.x = 99; } catch(e){ lw='threw'; }
    let sw=false; try { (function(){ 'use strict'; fz.x = 99; })(); } catch(e){ sw=e.constructor.name; }
    out.push('frozen-write loose=' + lw + ' strict=' + sw + ' value=' + fz.x);
    // plain
    const o = vm.runInNewContext('({a:1})');
    out.push('plain ' + JSON.stringify(Object.getOwnPropertyDescriptor(o, 'a')));
    // non-enum
    const ne = vm.runInNewContext('const x={}; Object.defineProperty(x,"h",{value:5,enumerable:false,writable:true,configurable:true}); x.v=1; x');
    out.push('nonenum keys=' + Object.keys(ne).join(',') + ' h=' + JSON.stringify(Object.getOwnPropertyDescriptor(ne, 'h')));
    // proto/has
    const ph = vm.runInNewContext('({a:1})');
    out.push('protohas ' + ('toString' in ph) + ' ' + ('a' in ph) + ' ' + (Object.getPrototypeOf(ph) === Object.prototype) + ' ' + (ph instanceof Object) + ' ' + (ph.constructor === Object) + ' ' + (typeof ph.toString));
    const pp = Object.getPrototypeOf(ph);
    out.push('protochain ' + (pp === null) + ' ' + (Object.getPrototypeOf(pp) === null) + ' ' + (typeof pp.hasOwnProperty));
    // accessor
    const ac = vm.runInNewContext('({ get g(){return 7} })');
    const gd = Object.getOwnPropertyDescriptor(ac, 'g');
    out.push('accessor get=' + typeof gd.get + ' set=' + typeof gd.set + ' enum=' + gd.enumerable + ' config=' + gd.configurable + ' val=' + ac.g + ' getcall=' + gd.get());
    // sealed
    const sl = vm.runInNewContext('Object.seal({y:2})');
    out.push('sealed sealed=' + Object.isSealed(sl) + ' frozen=' + Object.isFrozen(sl) + ' ext=' + Object.isExtensible(sl) + ' desc=' + JSON.stringify(Object.getOwnPropertyDescriptor(sl,'y')));
    sl.y = 7; out.push('sealed-write ' + sl.y);
    // write-through (host mutating a returned guest object)
    const wctx = vm.createContext({});
    vm.runInContext('globalThis.w = {a:1};', wctx);
    const wh = vm.runInContext('w', wctx);
    wh.b = 2; wh.a = 99;
    out.push('wt-set hostb=' + wh.b + ' guestb=' + vm.runInContext('w.b', wctx) + ' guesta=' + vm.runInContext('w.a', wctx));
    delete wh.a;
    out.push('wt-del hosta=' + wh.a + ' guesthas=' + vm.runInContext('("a" in w)', wctx));
    // defineProperty write-through (data + non-enum accessor)
    vm.runInContext('globalThis.dp = {z:1};', wctx);
    const dp = vm.runInContext('dp', wctx);
    Object.defineProperty(dp, 'wp', {value:5, enumerable:true, writable:true, configurable:true});
    out.push('define-data hostw=' + dp.wp + ' guestw=' + vm.runInContext('dp.wp', wctx) + ' keys=' + Object.keys(dp).join(','));
    Object.defineProperty(dp, 'acc', {get(){return 123}, enumerable:false, configurable:true});
    out.push('define-acc hostacc=' + dp.acc + ' guestacc=' + vm.runInContext('dp.acc', wctx) + ' keys=' + Object.keys(dp).join(','));
    // preventExtensions write-through
    vm.runInContext('globalThis.pe = {p:1};', wctx);
    const pe = vm.runInContext('pe', wctx);
    Object.preventExtensions(pe);
    out.push('prevent hostext=' + Object.isExtensible(pe) + ' guestext=' + vm.runInContext('Object.isExtensible(pe)', wctx));
    // wrapped-proto chain: a method off the guest Object.prototype resolves
    const po = vm.runInContext('({a:1})', wctx);
    const proto = Object.getPrototypeOf(po);
    out.push('proto callOwn=' + proto.hasOwnProperty.call(po, 'a') + ' proto.ctor.name=' + (proto.constructor && proto.constructor.name));
    out.push('hasOwn a=' + po.hasOwnProperty('a') + ' b=' + po.hasOwnProperty('b'));
    console.log(out.join('\\n'));
  `,
  expected:
    'frozen true {"value":1,"writable":false,"enumerable":true,"configurable":false}\n' +
    'frozen-write loose=false strict=TypeError value=1\n' +
    'plain {"value":1,"writable":true,"enumerable":true,"configurable":true}\n' +
    'nonenum keys=v h={"value":5,"writable":true,"enumerable":false,"configurable":true}\n' +
    'protohas true true false false false function\n' +
    'protochain false true function\n' +
    'accessor get=function set=undefined enum=true config=true val=7 getcall=7\n' +
    'sealed sealed=true frozen=false ext=false desc={"value":2,"writable":true,"enumerable":true,"configurable":false}\n' +
    'sealed-write 7\n' +
    'wt-set hostb=2 guestb=2 guesta=99\n' +
    'wt-del hosta=undefined guesthas=false\n' +
    'define-data hostw=5 guestw=5 keys=z,wp\n' +
    'define-acc hostacc=123 guestacc=123 keys=z,wp\n' +
    'prevent hostext=false guestext=false\n' +
    'proto callOwn=true proto.ctor.name=Object\n' +
    'hasOwn a=true b=false\n',
};

export default c;
