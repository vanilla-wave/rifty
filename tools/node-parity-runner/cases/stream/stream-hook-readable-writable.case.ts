/**
 * Readable `_read` and Writable `_write`/`_writev`/`_final` defined every Node
 * way run as in Node (`this` = stream, late lookup) — the dispatch model the
 * Duplex/Transform hooks follow.
 */
import type { ParityCase } from '../../src/types.ts';
import { WAYS_PRELUDE } from './stream-hook-ways.ts';

const c: ParityCase = {
  code: `${WAYS_PRELUDE}
for (const way of WAYS) {
  scenario('Readable ' + way + ' _read', (l) => {
    const r = make(Readable, { _read() { l.push('R:' + (this === r)); this.push('r'); this.push(null); } }, way);
    r.on('data', (c) => l.push('d' + c));
    r.on('error', (e) => l.push('error ' + e2s(e)));
  });
  scenario('Writable ' + way + ' _write+_final', (l) => {
    const w = make(Writable, {
      _write(c, e, cb) { l.push('W' + c + ':' + (this === w)); cb(); },
      _final(cb) { l.push('FIN:' + (this === w)); cb(); },
    }, way);
    w.on('finish', () => l.push('finish'));
    w.end('x');
  });
  scenario('Writable ' + way + ' _writev cork', (l) => {
    const w = make(Writable, {
      _write(c, e, cb) { l.push('W' + c); cb(); },
      _writev(chunks, cb) { l.push('V' + chunks.map((x) => x.chunk).join('|') + ':' + (this === w)); cb(); },
    }, way);
    w.cork();
    w.write('a');
    w.write('b');
    w.uncork();
    w.end('c');
  });
  scenario('Writable ' + way + ' _writev only', (l) => {
    const w = make(Writable, { _writev(chunks, cb) { l.push('V' + chunks.map((x) => x.chunk).join('|')); cb(); } }, way);
    w.on('error', (e) => l.push('error ' + e2s(e)));
    w.write('a');
    w.end('b');
  });
}
for (const Base of [Writable, Duplex]) {
  scenario(Base.name + ' single write leaves _writev unread', (l) => {
    class W extends Base {
      _read() {}
      _write(c, e, cb) { l.push('W' + c); cb(); }
      get _writev() { l.push('writev read'); return undefined; }
    }
    new W().write('x');
  });
}
scenario('prototype shape', () => () =>
  ['_write', '_writev', '_final'].map((k) => k + ':' + typeof Writable.prototype[k]).join(' ') +
  ' writev-null:' + (Writable.prototype._writev === null) + ' _read:' + typeof Readable.prototype._read);
done();
`,
};

export default c;
