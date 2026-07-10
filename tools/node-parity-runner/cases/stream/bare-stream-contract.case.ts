import type { ParityCase } from '../../src/types.ts';

/**
 * Bare-stream + subclass-dispatch contract vs real Node (v24):
 *   - a stream with NO implementation is LOUD, never a silent stub:
 *     bare `Readable.read()` destroys with `ERR_METHOD_NOT_IMPLEMENTED`
 *     ('error' event); bare `Writable.write()` / `Transform.write()` /
 *     `Duplex.write()` throw it SYNCHRONOUSLY; direct `_read`/`_write` calls
 *     throw. (Old rifty: no-op `_read` stalled forever, `_write`/`Transform`
 *     identity ACKed chunks it never processed — a silent success lie.)
 *   - prototype methods of subclasses ARE the implementation: Duplex `_write`/
 *     `_final`/`_writev`, Transform `_transform`/`_flush` dispatch like Node
 *     (rifty's own-property probe missed prototype methods).
 *   - `_writev`-only subclass: base `_write` delegates a single chunk to it.
 *   - `PassThrough` stays the identity transform.
 */
const c: ParityCase = {
  code: `
    const { Readable, Writable, Duplex, Transform, PassThrough } = require('node:stream');
    (async () => {
      const settle = () => new Promise((res) => setTimeout(res, 1));

      // 1. bare Readable: read() returns null (no sync throw), error EVENT, destroyed.
      const r = new Readable();
      let rErr = null;
      r.on('error', (e) => { rErr = e.code; });
      let rSync = 'none';
      let rRet = 'unset';
      try { rRet = String(r.read(1)); } catch (e) { rSync = e.code; }
      await settle();
      console.log('bare-readable: sync=' + rSync + ' ret=' + rRet + ' err=' + rErr + ' destroyed=' + r.destroyed);

      // 2. direct _read / _write throw synchronously.
      let d1 = 'none';
      try { new Readable()._read(1); } catch (e) { d1 = e.code + ':' + e.message; }
      console.log('direct-_read: ' + d1);
      let d2 = 'none';
      try { new Writable()._write('x', 'utf8', () => {}); } catch (e) { d2 = e.code + ':' + e.message; }
      console.log('direct-_write: ' + d2);

      // 3. bare Writable: write() throws SYNC (not an async error event).
      const w = new Writable();
      w.on('error', () => {});
      let wSync = 'none';
      try { w.write('x'); } catch (e) { wSync = e.code + ':' + e.message; }
      console.log('bare-writable: ' + wSync);

      // 4. _writev-only subclass: a single write routes through _writev.
      class WV extends Writable { _writev(chunks, cb) { console.log('writev-batch: ' + chunks.map((c) => c.chunk).join(',')); cb(); } }
      const wv = new WV();
      wv.write('a');
      await settle();

      // 5. bare Transform: write() throws SYNC with the _transform message.
      const t = new Transform();
      t.on('error', () => {});
      let tSync = 'none';
      try { t.write('x'); } catch (e) { tSync = e.code + ':' + e.message; }
      console.log('bare-transform: ' + tSync);

      // 6. bare Duplex: write() throws SYNC (_write); read() destroys via error event.
      const dp = new Duplex();
      let dpErr = null;
      dp.on('error', (e) => { dpErr = e.code; });
      let dpW = 'none';
      try { dp.write('x'); } catch (e) { dpW = e.code; }
      dp.read(1);
      await settle();
      console.log('bare-duplex: write=' + dpW + ' err=' + dpErr + ' destroyed=' + dp.destroyed);

      // 7. Duplex subclass prototype _write/_final dispatch.
      class DW extends Duplex { _read() {} _write(c, e, cb) { console.log('duplex-proto-write: ' + c); cb(); } _final(cb) { console.log('duplex-proto-final'); cb(); } }
      const dw = new DW();
      dw.write('zz');
      dw.end();
      await settle();

      // 8. Duplex subclass prototype _writev dispatch (writev-only duplex).
      class DV extends Duplex { _read() {} _writev(chunks, cb) { console.log('duplex-proto-writev: ' + chunks.map((c) => c.chunk).join(',')); cb(); } }
      const dv = new DV();
      dv.write('q');
      await settle();

      // 9. Transform subclass prototype _transform/_flush dispatch.
      class TT extends Transform { _transform(c, e, cb) { cb(null, String(c).toUpperCase()); } _flush(cb) { this.push('END'); cb(); } }
      const tt = new TT();
      const seen = [];
      tt.on('data', (c) => seen.push(String(c)));
      tt.write('ab');
      tt.end();
      await new Promise((res) => tt.on('end', res));
      console.log('transform-proto: ' + seen.join('|'));

      // 10. PassThrough identity unaffected by the bare-Transform throw.
      const pt = new PassThrough();
      const ptSeen = [];
      pt.on('data', (c) => ptSeen.push(String(c)));
      pt.write('ok');
      pt.end();
      await settle();
      console.log('passthrough: ' + ptSeen.join('|'));
    })();
  `,
};

export default c;
