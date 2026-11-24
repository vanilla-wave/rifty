/**
 * Duplex `_read`/`_write`/`_writev`/`_final` defined every Node way run as in
 * Node, with `this` = the Duplex (options too); a `_writev`-only Duplex
 * delivers every chunk. Pile-up batching instead of cork: Duplex cork is a
 * separate gap (`runtime-js/duplex-writable-surface-gaps`).
 */
import type { ParityCase } from '../../src/types.ts';
import { WAYS_PRELUDE } from './stream-hook-ways.ts';

const c: ParityCase = {
  code: `${WAYS_PRELUDE}
for (const way of WAYS) {
  scenario('Duplex ' + way + ' _read+_write+_final', (l) => {
    const reads = [];
    const data = [];
    const d = make(Duplex, {
      _read() { reads.push('R:' + (this === d)); this.push('r'); this.push(null); },
      _write(c, e, cb) { l.push('W' + c + ':' + (this === d)); cb(); },
      _final(cb) { l.push('FIN:' + (this === d)); cb(); },
    }, way);
    d.on('data', (c) => data.push(String(c)));
    d.on('error', (e) => l.push('error ' + e2s(e)));
    d.write('a');
    d.end('b');
    return () => l.join(',') + ' reads=' + reads.join(',') + ' data=' + data.join('');
  });
  scenario('Duplex ' + way + ' _writev batches a pile-up', (l) => {
    const d = make(Duplex, {
      _read() {},
      _write(c, e, cb) { l.push('W' + c); setTimeout(cb, 1); },
      _writev(chunks, cb) { l.push('V' + chunks.map((x) => x.chunk).join('|') + ':' + (this === d)); setTimeout(cb, 1); },
    }, way);
    d.write('a');
    d.write('b');
    d.write('c');
    d.end('d');
  });
  scenario('Duplex ' + way + ' _writev only', (l) => {
    const d = make(Duplex, {
      _read() {},
      _writev(chunks, cb) { l.push('V' + chunks.map((x) => x.chunk).join('|')); cb(); },
    }, way);
    d.on('error', (e) => l.push('error ' + e2s(e)));
    d.write('a');
    d.end('b');
  });
  scenario('Duplex ' + way + ' _write error', (l) => {
    const d = make(Duplex, { _read() {}, _write(c, e, cb) { cb(new Error('w-fail')); } }, way);
    d.on('error', (e) => l.push('error ' + e2s(e)));
    d.write('x', (e) => l.push('cb ' + e2s(e)));
  });
  scenario('Duplex ' + way + ' _final error', (l) => {
    const d = make(Duplex, {
      _read() {},
      _write(c, e, cb) { cb(); },
      _final(cb) { cb(new Error('f-fail')); },
    }, way);
    d.on('error', (e) => l.push('error ' + e2s(e)));
    d.end('x');
  });
}
scenario('Duplex prototype method replaced after construction', (l) => {
  class D extends Duplex { _read() {} _write(c, e, cb) { l.push('v1'); cb(); } }
  const d = new D();
  D.prototype._write = function (c, e, cb) { l.push('v2'); cb(); };
  d.end('x');
});
scenario('Duplex subclass passing write to super', (l) => {
  class D extends Duplex {
    constructor() { super({ read() {}, write(c, e, cb) { l.push('opt' + c); cb(); } }); }
    _write(c, e, cb) { l.push('proto' + c); cb(); }
  }
  new D().end('x');
});
scenario('prototype shape', () => () =>
  ['_write', '_writev', '_final', '_read'].map((k) => k + ':' + typeof Duplex.prototype[k]).join(' ') +
  ' shares-writable-write:' + (Duplex.prototype._write === Writable.prototype._write));
done();
`,
};

export default c;
