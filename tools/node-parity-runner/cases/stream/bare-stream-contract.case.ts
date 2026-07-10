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

      // 11. option-vs-prototype precedence: ctor assigns option hooks onto the
      // INSTANCE, so an option shadows a subclass PROTOTYPE method.
      class PW extends Writable { _write(c, e, cb) { console.log('prec-writable: proto'); cb(); } }
      new PW({ write(c, e, cb) { console.log('prec-writable: option'); cb(); } }).write('x');
      class PD extends Duplex { _read() {} _write(c, e, cb) { console.log('prec-duplex-write: proto'); cb(); } _final(cb) { console.log('prec-duplex-final: proto'); cb(); } }
      const pd = new PD({ write(c, e, cb) { console.log('prec-duplex-write: option'); cb(); }, final(cb) { console.log('prec-duplex-final: option'); cb(); } });
      pd.end('x');
      class PTR extends Transform { _transform(c, e, cb) { console.log('prec-transform: proto'); cb(null, c); } }
      const ptr = new PTR({ transform(c, e, cb) { console.log('prec-transform: option'); cb(null, c); } });
      ptr.on('data', () => {});
      ptr.write('x');
      await settle();

      // 12. a write OPTION on a Transform bypasses the transform machinery
      // (instance _write shadows Transform.prototype._write).
      const tw = new Transform({ transform(c, e, cb) { console.log('t-write-opt: transform'); cb(null, c); }, write(c, e, cb) { console.log('t-write-opt: write-option'); cb(); } });
      tw.on('data', () => {});
      tw.write('x');
      await settle();

      // 13. writev option on a Duplex is dispatched with the DUPLEX as this.
      let wvThis = 'unset';
      const dwv = new Duplex({ read() {}, writev(chunks, cb) { wvThis = String(this === dwv); cb(); } });
      dwv.write('a');
      dwv.write('b');
      await settle();
      console.log('writev-this-duplex: ' + wvThis);

      // 14. end(chunk) on a bare stream throws SYNC out of end(); a DESTROYED
      // bare stream instead reports via the write callback (state wins).
      const endRows = [];
      try { const d = new Duplex(); d.on('error', () => {}); d.end('x'); endRows.push('duplex:no-throw'); } catch (e) { endRows.push('duplex:' + e.code); }
      try { const t = new Transform(); t.on('error', () => {}); t.end('x'); endRows.push('transform:no-throw'); } catch (e) { endRows.push('transform:' + e.code + ':' + e.message); }
      try { const w = new Writable(); w.on('error', () => {}); w.end('x'); endRows.push('writable:no-throw'); } catch (e) { endRows.push('writable:' + e.code); }
      try {
        const d = new Duplex(); d.on('error', () => {}); d.destroy();
        d.end('x');
        endRows.push('destroyed:no-throw');
      } catch (e) { endRows.push('destroyed:' + e.code); }
      console.log('bare-end-chunk: ' + endRows.join(' '));

      // 15. Transform final/flush order: user final (option) -> flush ->
      // flush-data -> end -> finish; a final error skips flush (error, no finish/end).
      const ord = [];
      const tf = new Transform({
        transform(c, e, cb) { cb(null, c); },
        flush(cb) { ord.push('flush'); this.push('FLUSH-DATA'); cb(); },
        final(cb) { ord.push('final'); cb(); },
      });
      tf.on('data', (c) => ord.push('data:' + c));
      tf.on('end', () => ord.push('END'));
      tf.on('finish', () => ord.push('finish'));
      tf.end('x');
      await settle();
      await settle();
      console.log('transform-final-order: ' + ord.join('|'));
      const ordErr = [];
      const tfe = new Transform({
        transform(c, e, cb) { cb(null, c); },
        flush(cb) { ordErr.push('flush'); cb(); },
        final(cb) { ordErr.push('final'); cb(new Error('final-err')); },
      });
      tfe.on('data', () => {});
      tfe.on('error', (e) => ordErr.push('error:' + e.message));
      tfe.on('end', () => ordErr.push('END'));
      tfe.on('finish', () => ordErr.push('finish'));
      tfe.end('x');
      await settle();
      await settle();
      console.log('transform-final-error: ' + ordErr.join('|'));

      // 16. a value thrown from _read reaches 'error' RAW (primitive identity).
      const rp = new Readable({ read() { throw 'prim-str'; } });
      rp.on('error', (e) => console.log('read-throw-primitive: ' + typeof e + ':' + String(e) + ' destroyed=' + rp.destroyed));
      rp.read(1);
      await settle();

      // 17. PassThrough identity lives on the prototype: a transform OPTION
      // shadows it; a subclass prototype _transform overrides it.
      const ptOpt = new PassThrough({ transform(c, e, cb) { cb(null, 'OPT:' + c); } });
      const ptOptSeen = [];
      ptOpt.on('data', (c) => ptOptSeen.push(String(c)));
      ptOpt.write('ab');
      class PTSub extends PassThrough { _transform(c, e, cb) { cb(null, String(c).toUpperCase()); } }
      const ptSub = new PTSub();
      const ptSubSeen = [];
      ptSub.on('data', (c) => ptSubSeen.push(String(c)));
      ptSub.write('ab');
      await settle();
      console.log('passthrough-precedence: option=' + ptOptSeen.join('|') + ' subclass=' + ptSubSeen.join('|'));
    })();
  `,
};

export default c;
