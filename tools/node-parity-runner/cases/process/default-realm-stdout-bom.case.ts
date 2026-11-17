import type { ParityCase } from '../../src/types.ts';

// The spec-less default process (public runtime worker realm) decodes stdout
// writes for its console sink; a Buffer write keeps its leading BOM as Node's
// raw fd write does. One final write: the sink's per-write newline is the
// separate `runtime-js/default-realm-stdout-console-sink` gap.
const c: ParityCase = {
  code: `
    const nodeProcess = require('node:process');
    const { Buffer } = require('node:buffer');
    console.log('before');
    nodeProcess.stdout.write(Buffer.from([0xef, 0xbb, 0xbf, 0x42, 0x0a]));
  `,
};

export default c;
