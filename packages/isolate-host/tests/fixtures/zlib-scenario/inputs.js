// Node-only (the oracle): `node inputs.js out/<name>` writes that input of step 5a, 5b or 7b.
const zlib = require('node:zlib');
const { writeFileSync } = require('node:fs');

const text = 'the quick brown fox jumps over the lazy dog '.repeat(200);
const corrupt = zlib.deflateSync(text);
corrupt[20] ^= 0x55;
const inputs = {
  'out/two-members.gz': () =>
    Buffer.concat([zlib.gzipSync('first member\n'), zlib.gzipSync('second member\n')]),
  'out/text.gz': () => zlib.gzipSync(text),
  'out/text.zz': () => zlib.deflateSync(text),
  'out/corrupt.zz': () => corrupt,
};
writeFileSync(process.argv[2], inputs[process.argv[2]]());
