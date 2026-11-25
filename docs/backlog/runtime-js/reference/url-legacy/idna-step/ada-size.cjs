// Usage: node ada-size.cjs <ada.cpp> <scratch out.js>. Rough size of ada::idna tables (Node v24.16.0 deps/ada/ada.cpp) as base64 typed arrays.
'use strict';
const fs = require('node:fs');
const zlib = require('node:zlib');
const src = fs.readFileSync(process.argv[2], 'utf8');
const lines = src.split('\n');
const sec = (a, b) => lines.slice(a - 1, b).join('\n');
const nums = (s) => (s.match(/0x[0-9a-fA-F]+|\b\d+\b/g) || []).map(Number);
const decl =
  /(?:const|constexpr static|static)\s+(uint8_t|uint16_t|uint32_t|char32_t|directions)\s+(\w+)(\[[^=]*\])?\s*=\s*\{/g;
const body = sec(331, 9559);
const out = [];
let total = 0;
for (const m of body.matchAll(decl)) {
  let depth = 0;
  let i = m.index + m[0].length - 1;
  for (; i < body.length; i++) {
    if (body[i] === '{') depth++;
    else if (body[i] === '}' && --depth === 0) break;
  }
  const arr = nums(body.slice(m.index + m[0].length, i));
  const w = m[1] === 'uint8_t' ? 1 : m[1] === 'uint16_t' ? 2 : 4;
  const buf = Buffer.alloc(arr.length * w);
  arr.forEach((v, j) =>
    w === 1
      ? buf.writeUInt8(v & 255, j)
      : w === 2
        ? buf.writeUInt16LE(v & 65535, j * 2)
        : buf.writeUInt32LE(v >>> 0, j * 4),
  );
  out.push(`${m[2]}: ${arr.length}×${w}B`);
  total += buf.length;
  fs.appendFileSync(process.argv[3], `var ${m[2]}="${buf.toString('base64')}";\n`);
}
const js = fs.readFileSync(process.argv[3]);
console.log(out.join(', '));
console.log(
  'raw',
  total,
  'B; base64 js',
  js.length,
  'B; gzip',
  zlib.gzipSync(js, { level: 9 }).length,
  'B',
);
