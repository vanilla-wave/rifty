import type { ParityCase } from '../../src/types.ts';

/** A ReadStream chunk is the program's memory, not the file's: mutating it leaves the file alone. */
const c: ParityCase = {
  setup: { files: { 'o.bin': 'abc' } },
  code: `
    const fs = require('node:fs');
    fs.createReadStream('o.bin')
      .on('data', (chunk) => chunk.fill(0x39))
      .on('close', () => console.log(fs.readFileSync('o.bin', 'latin1')));
  `,
};

export default c;
