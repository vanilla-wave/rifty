/**
 * A hook that throws synchronously, as Node: `_write`/`_writev`/`_transform`
 * throws escape the `write()`/`uncork()` call (stream not destroyed); `_final`
 * (and `_flush`, run from Transform's `_final`) is caught and destroys the
 * stream with it (`'error'`, `'close'`, then the `end()` callback); `_read` destroys.
 */
import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
const { Readable, Writable, Duplex, Transform, PassThrough } = require('node:stream');
const lines = [];
const e2s = (e) => (e && e.message) || String(e);
function run(name, make, act) {
  const l = [];
  let s;
  try {
    s = make();
    s.on('error', (e) => l.push('error ' + e2s(e)));
    s.on('close', () => l.push('close'));
    act(s, l);
  } catch (e) {
    l.push('sync throw ' + e2s(e));
  }
  setTimeout(() => lines.push(name + ' => ' + l.join(',') + ' destroyed=' + (s && s.destroyed)), 30);
}
const boom = () => { throw new Error('boom'); };
for (const C of [Writable, Duplex]) {
  run(C.name + ' _write throws', () => new C({ read() {}, write: boom }), (s, l) => s.write('x', (e) => l.push('wcb ' + e2s(e))));
  run(C.name + ' _final throws', () => new C({ read() {}, write(c, e, cb) { cb(); }, final: boom }), (s, l) => s.end('x', (e) => l.push('endcb ' + e2s(e))));
  class F extends C { _read() {} _write(c, e, cb) { cb(); } _final() { throw new Error('boom'); } }
  run(C.name + ' subclass _final throws', () => new F(), (s, l) => s.end('x', (e) => l.push('endcb ' + e2s(e))));
}
run('Writable _writev throws (uncork)', () => new Writable({ write(c, e, cb) { cb(); }, writev: boom }), (s) => { s.cork(); s.write('a'); s.write('b'); s.uncork(); });
run('Writable _writev-only throws', () => new Writable({ writev: boom }), (s) => s.write('a'));
for (const C of [Transform, PassThrough]) {
  run(C.name + ' _transform throws', () => new C({ transform: boom }), (s, l) => { s.on('data', () => {}); s.write('x', (e) => l.push('wcb ' + e2s(e))); });
  run(C.name + ' _flush throws', () => new C({ transform(c, e, cb) { cb(null, c); }, flush: boom }), (s, l) => { s.on('data', () => {}); s.end('x', (e) => l.push('endcb ' + e2s(e))); });
  run(C.name + ' _final throws', () => new C({ transform(c, e, cb) { cb(null, c); }, final: boom }), (s, l) => { s.on('data', () => {}); s.end('x', (e) => l.push('endcb ' + e2s(e))); });
}
class TF extends Transform { _transform(c, e, cb) { cb(null, c); } _flush() { throw new Error('boom'); } }
run('Transform subclass _flush throws', () => new TF(), (s, l) => { s.on('data', () => {}); s.end('x', (e) => l.push('endcb ' + e2s(e))); });
run('Readable _read throws', () => new Readable({ read: boom }), (s) => s.on('data', () => {}));
run('Duplex _read throws', () => new Duplex({ read: boom, write(c, e, cb) { cb(); } }), (s) => s.on('data', () => {}));
setTimeout(() => { for (const x of lines) console.log(x); }, 80);
`,
};

export default c;
