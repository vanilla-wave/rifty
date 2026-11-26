import type { ParityCase } from '../../src/types.ts';

/** A write from a SharedArrayBuffer view keeps its bytes when the shared memory changes. */
const c: ParityCase = {
  code: `
    const fs = require('node:fs');
    const shared = new Uint8Array(new SharedArrayBuffer(4));
    shared.set([0, 1, 2, 3]);
    fs.writeFileSync('e', shared.subarray(1));
    shared.fill(9);
    console.log(Array.from(fs.readFileSync('e')).join(','));
  `,
};

export default c;
