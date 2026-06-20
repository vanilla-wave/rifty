import type { ParityCase } from '../../src/types.ts';

/**
 * `util.inspect(buffer)` renders Node's `<Buffer 01 02 …>` hex, truncating at the
 * LIVE `buffer.INSPECT_MAX_BYTES` (mutating it changes the cut). Requires
 * `node:buffer`/`node:util` so rifty's inspector + Buffer are exercised. Resets
 * INSPECT_MAX_BYTES to its default at the end — the runner shares one rifty realm
 * across cases, so a leaked value would truncate later buffer renders.
 */
const c: ParityCase = {
  code: `
    const util = require('node:util');
    const buf = require('node:buffer');
    const { Buffer } = buf;
    console.log(util.inspect(Buffer.from([1, 2, 255])));
    console.log(util.inspect(Buffer.alloc(0)));
    console.log(util.inspect(Buffer.alloc(60, 0x61)));
    buf.INSPECT_MAX_BYTES = 4;
    console.log(util.inspect(Buffer.from([1, 2, 3, 4, 5, 6])));
    buf.INSPECT_MAX_BYTES = 50;
    // Own enumerable (non-index) props are appended after the hex (Node parity).
    const withProps = Buffer.from([1, 2, 3]);
    withProps.foo = 'bar';
    withProps.num = 42;
    console.log(util.inspect(withProps));
  `,
};

export default c;
