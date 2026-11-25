// Rough size of a table derived from live Node's output for the five ICU-only encodings: every
// 2-byte sequence with a high lead byte (and euc-jp's 3-byte 8f form), NUL-joined, gzip -9.
// Usage: node icu-dump-size.cjs
'use strict';
const zlib = require('node:zlib');

for (const enc of ['big5', 'euc-jp', 'shift_jis', 'euc-kr', 'iso-2022-jp']) {
  const d = new TextDecoder(enc);
  const out = [];
  for (let a = 0x80; a <= 0xff; a++) {
    for (let b = 0x00; b <= 0xff; b++) out.push(d.decode(Uint8Array.of(a, b)));
  }
  let three = 0;
  if (enc === 'euc-jp') {
    for (let b = 0xa1; b <= 0xfe; b++) {
      for (let c = 0xa1; c <= 0xfe; c++) {
        out.push(d.decode(Uint8Array.of(0x8f, b, c)));
        three++;
      }
    }
  }
  const txt = out.join('\u0000');
  const gz = zlib.gzipSync(txt, { level: 9 }).length;
  console.log(enc, 'pairs', 128 * 256, 'three', three, 'raw', Buffer.byteLength(txt), 'gzip', gz);
}
