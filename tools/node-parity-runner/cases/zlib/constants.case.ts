import type { ParityCase } from '../../src/types.ts';

// Pins `zlib.constants` / `zlib.codes` (pure data) + the legacy top-level
// constant aliases byte-for-byte against real Node (ADR-0158). A deterministic
// sorted dump so a single missing/wrong constant value diverges loudly.
const c: ParityCase = {
  code: `
    const zlib = require('node:zlib');

    for (const key of Object.keys(zlib.constants).sort()) {
      console.log(key + '=' + String(zlib.constants[key]));
    }
    // Legacy top-level aliases (Node mirrors every non-BROTLI_ constant here).
    console.log('top.Z_BEST_COMPRESSION=' + String(zlib.Z_BEST_COMPRESSION));
    console.log('top.Z_DEFAULT_CHUNK=' + String(zlib.Z_DEFAULT_CHUNK));
    console.log('top.GZIP=' + String(zlib.GZIP));
    console.log('top.BROTLI_PARAM_QUALITY=' + String(zlib.BROTLI_PARAM_QUALITY));

    // codes map (both directions).
    console.log('codes.Z_OK=' + String(zlib.codes.Z_OK));
    console.log('codes.0=' + String(zlib.codes['0']));
    console.log('codes.-3=' + String(zlib.codes['-3']));
  `,
};

export default c;
