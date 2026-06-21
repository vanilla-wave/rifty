import type { ParityCase } from '../../src/types.ts';

/**
 * `crypto.hash` one-shot helper (Node v20.12/21.7) — sync wrapper over the
 * shipped pure-JS hash cores (sha256/sha1/md5). Pins digest bytes, the
 * default-`hex`-string return, explicit encodings, Buffer-input, and the
 * `'buffer'` output mode head-to-head against real Node. Supported algos only
 * (unsupported algos are an intentional honest `NotImplementedError` gap, not a
 * parity target — backlog `runtime-js/crypto-random-and-oneshot`).
 */
const c: ParityCase = {
  expected: [
    'sha256-abc:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    'sha256-bufinput:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    'sha1-empty:da39a3ee5e6b4b0d3255bfef95601890afd80709',
    'md5-abc:900150983cd24fb0d6963f7d28e17f72',
    'sha256-b64:ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=',
    'default-string:string',
    'buffer-isview:true',
    'buffer-hex:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    'latin1-len:32',
    'dataview:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    'arraybuffer-rejects:ERR_INVALID_ARG_TYPE',
  ].join('\n'),
  code: `
    const crypto = require('node:crypto');
    console.log('sha256-abc:' + crypto.hash('sha256', 'abc'));
    console.log('sha256-bufinput:' + crypto.hash('sha256', Buffer.from('abc')));
    console.log('sha1-empty:' + crypto.hash('sha1', ''));
    console.log('md5-abc:' + crypto.hash('md5', 'abc'));
    console.log('sha256-b64:' + crypto.hash('sha256', 'abc', 'base64'));
    console.log('default-string:' + typeof crypto.hash('sha256', 'abc'));
    // Cross-realm Buffer identity differs in the parity harness; the same-realm
    // Buffer.isBuffer contract is covered by the runtime-js unit test. Here assert
    // the byte-view shape (true for both Node Buffer and rifty Buffer).
    console.log('buffer-isview:' + (crypto.hash('sha256', 'abc', 'buffer') instanceof Uint8Array));
    console.log('buffer-hex:' + crypto.hash('sha256', 'abc', 'buffer').toString('hex'));
    // 'latin1' is Node's alias for 'binary' — a 32-byte sha256 digest as a
    // single-byte string is 32 chars (the bytes themselves vary, so length only).
    console.log('latin1-len:' + crypto.hash('sha256', 'abc', 'latin1').length);
    // Input types: a DataView (any ArrayBufferView) is accepted; a RAW ArrayBuffer
    // is rejected by Node with ERR_INVALID_ARG_TYPE.
    console.log('dataview:' + crypto.hash('sha256', new DataView(new Uint8Array([97, 98, 99]).buffer)));
    let abErr = 'NO-THROW';
    try { crypto.hash('sha256', new Uint8Array([97, 98, 99]).buffer); } catch (x) { abErr = x.code; }
    console.log('arraybuffer-rejects:' + abErr);
  `,
};

export default c;
