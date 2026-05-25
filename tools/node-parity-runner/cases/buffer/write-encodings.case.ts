/**
 * `Buffer.write(string, offset?, length?, encoding?)` must honor BOTH the
 * `length` (truncation) and the `encoding` arguments. Previously the rifty
 * implementation ignored both and always wrote utf8 to fit.
 *
 * The case binds the runtime's `node:buffer` to a local so the parity-runner
 * actually exercises `@rifty/io`'s Buffer instead of the host's Node Buffer.
 */
import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const { Buffer } = require('node:buffer');

    // ---- utf8 (default) ----
    const utf8 = Buffer.alloc(8, 0);
    const n1 = utf8.write('hello');
    console.log('utf8:', n1, utf8.toString('hex'));

    // ---- length truncation ----
    const tr = Buffer.alloc(8, 0);
    const n2 = tr.write('hello', 0, 3);
    console.log('trunc:', n2, tr.toString('hex'));

    // ---- utf16le ----
    const u16 = Buffer.alloc(8, 0);
    const n3 = u16.write('ab', 0, 4, 'utf16le');
    console.log('utf16:', n3, u16.toString('hex'));

    // ---- hex ----
    const hex = Buffer.alloc(4, 0);
    const n4 = hex.write('deadbeef', 0, 'hex');
    console.log('hex:', n4, hex.toString('hex'));

    // ---- ascii ----
    const ascii = Buffer.alloc(4, 0);
    const n5 = ascii.write('ABCD', 'ascii');
    console.log('ascii:', n5, ascii.toString('hex'));

    // ---- latin1 ----
    const lat = Buffer.alloc(4, 0);
    const n6 = lat.write('\\xff\\x80\\x40\\x10', 'latin1');
    console.log('latin1:', n6, lat.toString('hex'));

    // ---- base64 ----
    const b64 = Buffer.alloc(6, 0);
    const n7 = b64.write('aGVsbG8h', 0, 'base64');
    console.log('base64:', n7, b64.toString('utf8'));

    // ---- offset + utf16le length truncation ----
    const off = Buffer.alloc(10, 0);
    const n8 = off.write('xyz', 2, 4, 'utf16le');
    console.log('off:', n8, off.toString('hex'));

    // ---- length=0 ----
    const zero = Buffer.alloc(4, 0xff);
    const n9 = zero.write('abc', 0, 0);
    console.log('zero:', n9, zero.toString('hex'));
  `,
};

export default c;
