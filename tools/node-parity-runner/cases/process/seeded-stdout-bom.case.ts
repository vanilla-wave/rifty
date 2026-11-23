import type { ParityCase } from '../../src/types.ts';

// A kernel-spec process writing EF BB BF at stdout offset 0 delivers it
// verbatim; the runner's seeded-process capture keeps the BOM like the Node
// side (traps.md parity-capture-bom).
const c: ParityCase = {
  stdin: [Uint8Array.of(0x0a)],
  code: `
    const process = require('node:process');
    const { Buffer } = require('node:buffer');
    process.stdout.write(Buffer.from([0xef, 0xbb, 0xbf, 0x42, 0x0a]));
    process.stdin.resume();
  `,
};

export default c;
