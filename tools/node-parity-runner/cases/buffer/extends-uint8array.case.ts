/**
 * Buffer extends Uint8Array (Node semantics). Verifies:
 *
 *   - `Buffer.isBuffer(subarray)` is true (Node's `subarray` returns a Buffer
 *     via `Symbol.species`).
 *   - `sub instanceof Uint8Array` is true.
 *   - `sub.toString('utf8')` honors the Buffer encoding overload (not just
 *     `Uint8Array.prototype.toString`).
 *   - `Buffer.isBuffer(buf.slice(...))` is true (deprecated alias of subarray).
 */
import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const { Buffer } = require('node:buffer');
    const buf = Buffer.from('hello');
    const sub = buf.subarray(1, 4);
    console.log(JSON.stringify({
      isBuffer: Buffer.isBuffer(sub),
      isUint8: sub instanceof Uint8Array,
      str: sub.toString('utf8'),
      fromSliceIsBuffer: Buffer.isBuffer(buf.slice(0, 2)),
    }));
  `,
};

export default c;
