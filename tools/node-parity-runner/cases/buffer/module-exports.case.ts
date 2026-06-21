import type { ParityCase } from '../../src/types.ts';

/**
 * `node:buffer` module-level exports beyond `{ Buffer }`: browser-native
 * Blob/File/atob/btoa re-exports, SlowBuffer (= allocUnsafeSlow), the
 * isUtf8/isAscii byte predicates, and INSPECT_MAX_BYTES (default 50).
 * Requires `node:buffer` explicitly so the rifty registry surface is exercised
 * (a bare global would be Node's in the in-process runner).
 */
const c: ParityCase = {
  code: `
    const buf = require('node:buffer');
    const { Buffer } = buf;
    console.log(typeof buf.Blob, typeof buf.File, typeof buf.atob, typeof buf.btoa);
    console.log(buf.btoa('hi'), buf.atob('aGk='));
    console.log(buf.isUtf8(Buffer.from('héllo')), buf.isUtf8(Buffer.from([0xff, 0xfe])));
    console.log(buf.isAscii(Buffer.from('abc')), buf.isAscii(Buffer.from('héllo')));
    console.log(buf.isUtf8(new ArrayBuffer(0))); // ArrayBuffer accepted
    // DataView rejected (Node parity), unlike a TypedArray.
    try { buf.isUtf8(new DataView(new ArrayBuffer(4))); console.log('DV', 'NO_THROW'); }
    catch (e) { console.log('DV', e.constructor.name); }
    console.log(buf.SlowBuffer(3).length, Buffer.isBuffer(buf.SlowBuffer(3)));
    console.log(buf.INSPECT_MAX_BYTES);
  `,
};

export default c;
