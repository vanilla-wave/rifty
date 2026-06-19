import type { ParityCase } from '../../src/types.ts';

// Node's `fs.createReadStream(path, {start, end})` byte range is INCLUSIVE of
// `end`: {start:2,end:7} over 'abcdefghij' delivers bytes 2..7 = 'cdefgh'
// (end-start+1 = 6 bytes). An exclusive-end off-by-one would drop the last byte
// ('cdefg'). JSON.stringify pins the exact bytes head-to-head against real Node
// (no `expected` — compared directly).
const c: ParityCase = {
  setup: {
    files: {
      'data.txt': 'abcdefghij',
    },
  },
  code: `
    const fs = require('node:fs');
    const chunks = [];
    const stream = fs.createReadStream('data.txt', { start: 2, end: 7 });
    stream.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c.toString('latin1') : String(c)));
    stream.on('end', () => console.log(JSON.stringify(chunks.join(''))));
  `,
};

export default c;
