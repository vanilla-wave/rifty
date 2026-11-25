// Step 7a: zlib.crc32 of every file steps 1, 3w and 4 wrote.
const zlib = require('node:zlib');
const { readFileSync } = require('node:fs');

for (const name of ['out.xlsx', 'out.png', 'out.pdf'])
  console.log(`crc32 ${name} ${zlib.crc32(readFileSync(`in/${name}`))}`);
