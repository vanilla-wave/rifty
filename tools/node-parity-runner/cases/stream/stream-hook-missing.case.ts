/**
 * No hook → Node's `ERR_METHOD_NOT_IMPLEMENTED`, bare and subclassed: the
 * first `write()` throws `_write()` (Writable/Duplex) or `_transform()`
 * (Transform); a Readable emits `_read()`. Never a silent sink or pass-through.
 */
import type { ParityCase } from '../../src/types.ts';
import { WAYS_PRELUDE } from './stream-hook-ways.ts';

const c: ParityCase = {
  code: `${WAYS_PRELUDE}
for (const Base of [Readable, Writable, Duplex, Transform]) {
  for (const shape of ['bare', 'subclass', 'es5']) {
    scenario(Base.name + ' ' + shape + ' without hooks', (l) => {
      const s = shape === 'bare' ? new Base() : make(Base, {}, shape === 'subclass' ? 'class' : 'es5');
      s.on('error', (e) => l.push('error ' + e2s(e)));
      if (Base !== Writable) s.on('data', (c) => l.push('d' + c));
      if (Base !== Readable) {
        try {
          s.write('x', (e) => l.push('cb ' + e2s(e)));
          l.push('wrote');
        } catch (e) {
          l.push('throw ' + e2s(e));
        }
      }
    });
  }
}
scenario('Transform with only flush', (l) => {
  const t = new Transform({ flush(cb) { l.push('F'); cb(); } });
  try { t.end('x'); } catch (e) { l.push('throw ' + e2s(e)); }
});
done();
`,
};

export default c;
