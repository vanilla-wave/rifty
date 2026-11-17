import type { ParityCase } from '../../src/types.ts';

// Node keeps a leading UTF-8 BOM on every Buffer decode (only WHATWG
// TextDecoder's default strips it). Explicit `node:buffer` import: a bare
// `Buffer` is the host's in this runner (traps.md parity-runner-in-process).
const c: ParityCase = {
  code: `
    const { Buffer } = require('node:buffer');
    const cps = (s) => s.length + ':' + [...s].map((ch) => ch.codePointAt(0).toString(16)).join(' ');
    const bom = Buffer.from([0xef, 0xbb, 0xbf, 0x41]);
    console.log('utf8', cps(bom.toString('utf8')));
    console.log('utf-8', cps(bom.toString('utf-8')));
    console.log('default', cps(bom.toString()));
    console.log('range', cps(bom.toString('utf8', 0, 4)));
    console.log('after-bom', cps(bom.toString('utf8', 3)));
    console.log('subarray', cps(bom.subarray(0, 3).toString('utf8')));
    console.log('double', cps(Buffer.from([0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 0x42]).toString('utf8')));
    console.log('utf16le', cps(Buffer.from([0xff, 0xfe, 0x41, 0x00]).toString('utf16le')));
    console.log('roundtrip', Buffer.from('\\ufeffA').toString('hex'), Buffer.byteLength('\\ufeff'));
  `,
};

export default c;
