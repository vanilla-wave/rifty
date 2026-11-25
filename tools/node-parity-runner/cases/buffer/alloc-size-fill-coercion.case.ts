/**
 * `Buffer.alloc(size, fill, enc)` is Node's `_fill(buf, fill, 0, buf.length, enc)`: a fractional
 * `size` truncates before the fill range is set. A fill that is neither a string, a number nor an
 * ArrayBufferView is ToUint32'd (`true` → 1, `{}`/`[]`/`null` → 0); a view tiles its bytes.
 */
import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const { Buffer } = require('node:buffer');
    const label = (e) =>
      'threw ' + (e && e.name) + (e && e.code !== undefined ? ' ' + e.code : '') + ': ' + (e && e.message);
    const run = (f) => {
      try {
        const v = f();
        return v instanceof Uint8Array ? 'bytes ' + Buffer.from(v).toString('hex') + ' len ' + v.length : JSON.stringify(v);
      } catch (e) {
        return label(e);
      }
    };
    const FILLS = [undefined, 0, 7, 'a', 'ab', true, false, null, {}, [], 1.5, -1, 257, Buffer.from([1, 2])];
    const show = (v) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v));
    for (const size of [0, 0.5, 1, 1.5, 2.9, 3])
      for (const fill of FILLS) console.log('alloc', size, show(fill), run(() => Buffer.alloc(size, fill)));
    console.log('alloc hex 2.5', run(() => Buffer.alloc(2.5, 'abcd', 'hex')));
    console.log('alloc utf16le 3.7', run(() => Buffer.alloc(3.7, 'ab', 'UTF-16LE')));
    for (const [k, v] of [['true', true], ['{}', {}], ['[]', []], ['null', null], ['10n', 10n], ['symbol', Symbol('s')]])
      console.log('fill', k, run(() => Buffer.alloc(3).fill(v)));
    console.log('fill Uint16Array', run(() => Buffer.alloc(5).fill(new Uint16Array([0x0102]))));
    console.log('fill DataView', run(() => Buffer.alloc(5).fill(new DataView(new Uint8Array([9, 8]).buffer))));
  `,
};

export default c;
