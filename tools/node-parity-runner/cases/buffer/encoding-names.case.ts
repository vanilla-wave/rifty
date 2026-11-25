/**
 * Every encoding spelling Node's `normalizeEncoding` (lib/internal/util.js) maps,
 * plus names it rejects, through every Buffer entry point taking an encoding.
 * Each entry point keeps Node's own default rule: `from`/`write` take `''` as
 * utf8, `toString`/`indexOf` reject it, `fill`/`alloc` normalise it, `byteLength`
 * falls back to utf8 for an unknown name. An empty `toString` range returns ''
 * before the name is checked.
 *
 * Inputs isolate name resolution: `'4142'` is valid in every encoding, the
 * haystack puts the utf16le needle at an even offset (Node searches utf16le by
 * aligned code units), writes never cut a character.
 */
import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const { Buffer } = require('node:buffer');
    const NAMES = [
      'utf8', 'UTF8', 'Utf8', 'uTF8', 'utf-8', 'UTF-8', 'Utf-8',
      'ucs2', 'UCS2', 'Ucs2', 'ucs-2', 'UCS-2', 'Ucs-2',
      'utf16le', 'UTF16LE', 'Utf16le', 'utf-16le', 'UTF-16LE', 'Utf-16LE',
      'latin1', 'LATIN1', 'Latin1', 'binary', 'BINARY', 'Binary',
      'base64', 'BASE64', 'Base64', 'base64url', 'BASE64URL', 'Base64Url',
      'hex', 'HEX', 'Hex', 'ascii', 'ASCII', 'Ascii',
      '', undefined,
      'nope', 'utf16', 'utf-16', 'UTF_8', 'utf 8', ' utf8', 'utf8 ', 'latin-1', 'base-64', 'buffer',
    ];
    const label = (e) =>
      'threw ' + (e && e.name) + (e && e.code !== undefined ? ' ' + e.code : '') + ': ' + (e && e.message);
    const run = (f) => {
      try {
        const v = f();
        return v instanceof Uint8Array ? 'bytes ' + Buffer.from(v).toString('hex') : JSON.stringify(v);
      } catch (e) {
        return label(e);
      }
    };
    const BYTES = Buffer.from([0x41, 0xe9, 0x00, 0xff, 0x80, 0x34]);
    const H = Buffer.concat([
      Buffer.from('4142', 'latin1'),
      Buffer.from('4142', 'utf16le'),
      Buffer.from('4142', 'hex'),
      Buffer.from('4142', 'base64'),
    ]);
    const written = (f) => () => {
      const b = Buffer.alloc(8, 0xee);
      return [f(b), b.toString('hex')];
    };
    for (const n of NAMES) {
      const rows = [
        ['isEncoding', () => Buffer.isEncoding(n)],
        ['toString', () => BYTES.toString(n)],
        ['toString(1,4)', () => BYTES.toString(n, 1, 4)],
        ['toString(2,2)', () => BYTES.toString(n, 2, 2)],
        ['empty.toString', () => Buffer.alloc(0).toString(n)],
        ['subarray.toString', () => BYTES.subarray(1).toString(n)],
        ['from', () => Buffer.from('4142', n)],
        ['from Ae', () => Buffer.from('A\\u00e9', n)],
        ['byteLength', () => Buffer.byteLength('4142', n)],
        ['byteLength Ae', () => Buffer.byteLength('A\\u00e9', n)],
        ['write(s,enc)', written((b) => b.write('4142', n))],
        ['write(s,1,enc)', written((b) => b.write('4142', 1, n))],
        ['write(s,1,6,enc)', written((b) => b.write('4142', 1, 6, n))],
        ['fill(v,enc)', () => Buffer.alloc(6).fill('4142', n)],
        ['fill(v,1,enc)', () => Buffer.alloc(6).fill('4142', 1, n)],
        ['fill(v,1,5,enc)', () => Buffer.alloc(6).fill('4142', 1, 5, n)],
        ['alloc(n,v,enc)', () => Buffer.alloc(6, '4142', n)],
        ['indexOf(s,enc)', () => H.indexOf('4142', n)],
        ['indexOf(s,1,enc)', () => H.indexOf('4142', 1, n)],
        ['lastIndexOf(s,enc)', () => H.lastIndexOf('4142', n)],
        ['includes(s,enc)', () => H.includes('4142', n)],
        ['indexOf(buf,0,enc)', () => H.indexOf(Buffer.from([0x41, 0x42]), 0, n)],
        ['concat', () => Buffer.concat([Buffer.from('4142', n), Buffer.from('A\\u00e9', n)])],
      ];
      for (const [k, f] of rows) console.log(JSON.stringify(n), k, run(f));
    }
  `,
};

export default c;
