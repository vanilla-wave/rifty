/**
 * Transform/PassThrough `_transform`/`_flush`/`_final` defined every Node way
 * (option, own property, ES class, ES5 inherits, chain, late prototype) run as
 * in Node: fast-csv's `CsvFormatterStream extends Transform { _transform }`.
 */
import type { ParityCase } from '../../src/types.ts';
import { WAYS_PRELUDE } from './stream-hook-ways.ts';

const c: ParityCase = {
  code: `${WAYS_PRELUDE}
for (const way of WAYS) {
  for (const Base of [Transform, PassThrough]) {
    scenario(Base.name + ' ' + way + ' _transform+_flush', (l) => {
      const data = [];
      const t = make(Base, {
        _transform(c, e, cb) { l.push('T' + c + ':' + (this === t)); this.push('<' + c + '>'); cb(); },
        _flush(cb) { l.push('F:' + (this === t)); this.push('!'); cb(); },
      }, way);
      t.on('data', (c) => data.push(String(c)));
      t.on('error', (e) => l.push('error ' + e2s(e)));
      t.write('a');
      t.end('b');
      return () => l.join(',') + ' data=' + data.join('');
    });
    scenario(Base.name + ' ' + way + ' callback value', (l) => {
      const data = [];
      const t = make(Base, { _transform(c, e, cb) { cb(null, String(c).toUpperCase()); } }, way);
      t.on('data', (c) => data.push(String(c)));
      t.end('q');
      return () => 'data=' + data.join('');
    });
  }
  scenario('Transform ' + way + ' _final then _flush', (l) => {
    const data = [];
    const t = make(Transform, {
      _transform(c, e, cb) { cb(null, c); },
      _final(cb) { l.push('final:' + (this === t)); cb(); },
      _flush(cb) { l.push('flush'); cb(); },
    }, way);
    t.on('data', (c) => data.push(String(c)));
    t.end('x');
    return () => l.join(',') + ' data=' + data.join('');
  });
  scenario('Transform ' + way + ' _flush error', (l) => {
    const t = make(Transform, {
      _transform(c, e, cb) { cb(null, c); },
      _flush(cb) { cb(new Error('flush-fail')); },
    }, way);
    t.on('data', () => {});
    t.on('error', (e) => l.push('error ' + e2s(e)));
    t.end('x');
  });
  scenario('Transform ' + way + ' _transform error', (l) => {
    const t = make(Transform, { _transform(c, e, cb) { cb(new Error('t-fail')); } }, way);
    t.on('error', (e) => l.push('error ' + e2s(e)));
    t.write('x', (e) => l.push('cb ' + e2s(e)));
  });
}
scenario('Transform prototype method replaced after construction', (l) => {
  class X extends Transform { _transform(c, e, cb) { cb(null, 'v1'); } }
  const t = new X();
  X.prototype._transform = function (c, e, cb) { cb(null, 'v2'); };
  const data = [];
  t.on('data', (c) => data.push(String(c)));
  t.end('x');
  return () => 'data=' + data.join('');
});
scenario('Transform subclass with _transform and a public transform() method (fast-csv shape)', (l) => {
  class F extends Transform {
    constructor() { super({ writableObjectMode: true }); }
    transform() { return this; }
    _transform(row, e, cb) { this.push(Buffer.from(row.join(',') + '\\n')); cb(); }
  }
  const f = new F();
  const data = [];
  f.on('data', (c) => data.push(Buffer.isBuffer(c) + ':' + String(c).trim()));
  f.write(['a', 1]);
  f.end(['b', 2]);
  return () => 'data=' + data.join('|');
});
scenario('PassThrough subclass without _transform', (l) => {
  class P extends PassThrough {}
  const p = new P();
  const data = [];
  p.on('data', (c) => data.push(String(c)));
  p.end('same');
  return () => 'data=' + data.join('');
});
scenario('prototype shape', () => () =>
  ['_transform', '_flush', '_final', '_write', '_read'].map((k) => k + ':' + typeof Transform.prototype[k]).join(' ') +
  ' passthrough-own-transform:' + Object.prototype.hasOwnProperty.call(PassThrough.prototype, '_transform'));
done();
`,
};

export default c;
