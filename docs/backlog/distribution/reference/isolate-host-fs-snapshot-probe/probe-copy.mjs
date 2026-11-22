import ivm from '../../../../../packages/isolate-host/node_modules/isolated-vm/isolated-vm.js';
const iso = new ivm.Isolate({ memoryLimit: 256 }); const ctx = await iso.createContext();
const big = new Uint8Array(64 * 1024 * 1024); big.fill(7, 100, 110);
const view = big.subarray(100, 110);
// host -> isolate
await ctx.evalClosure('globalThis.a = $0.copyInto(); globalThis.b = $1;', [new ivm.ExternalCopy(view), view], { arguments: { copy: true } });
console.log('in:', await ctx.eval('[Object.prototype.toString.call(a), a.byteLength, a.buffer?.byteLength, Object.prototype.toString.call(b), b.byteLength, b.buffer.byteLength, b[0]].join(" ")'));
// isolate -> host: a view over a big buffer
await ctx.eval('globalThis.big = new Uint8Array(64*1024*1024); big[5]=9; globalThis.v = big.subarray(5, 15); undefined');
const t = Date.now(); const out = await (await ctx.global.get('v', { reference: true })).copy();
console.log('out:', Object.prototype.toString.call(out), out.byteLength, out.buffer.byteLength, out[0], Date.now() - t, 'ms');
const cb = []; await ctx.evalClosure('$0(v)', [new ivm.Callback((x) => cb.push(x))]);
console.log('callback arg:', Object.prototype.toString.call(cb[0]), cb[0].byteLength, cb[0].buffer.byteLength);
