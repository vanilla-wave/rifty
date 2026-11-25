/**
 * `Buffer.byteLength(value, enc)`: an ArrayBufferView, ArrayBuffer or SharedArrayBuffer returns its
 * `byteLength` whatever the encoding; any other non-string throws ERR_INVALID_ARG_TYPE.
 */
import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const { Buffer } = require('node:buffer');
    const label = (e) =>
      'threw ' + (e && e.name) + (e && e.code !== undefined ? ' ' + e.code : '') + ': ' + (e && e.message);
    const run = (f) => {
      try {
        return JSON.stringify(f());
      } catch (e) {
        return label(e);
      }
    };
    const VALUES = {
      Buffer: Buffer.from([0xff, 0xfe, 0, 1, 2]),
      'Buffer.subarray': Buffer.from([1, 2, 3, 4, 5, 6]).subarray(1, 4),
      Uint8Array: new Uint8Array([1, 2, 3, 4, 5]),
      Uint16Array: new Uint16Array(3),
      Float64Array: new Float64Array(2),
      DataView: new DataView(new ArrayBuffer(6), 1, 4),
      ArrayBuffer: new ArrayBuffer(5),
      SharedArrayBuffer: new SharedArrayBuffer(7),
      'empty Buffer': Buffer.alloc(0),
    };
    for (const [k, v] of Object.entries(VALUES))
      for (const enc of [undefined, 'utf8', 'hex', 'base64', 'ucs2', 'latin1', 'nope'])
        console.log(k, enc, run(() => Buffer.byteLength(v, enc)));
    for (const [k, v] of [['1', 1], ['undefined', undefined], ['null', null], ['true', true], ['{}', {}], ['10n', 10n]])
      console.log('bad', k, run(() => Buffer.byteLength(v)));
  `,
};

export default c;
