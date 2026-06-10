import type { ParityCase } from '../../src/types.ts';

/**
 * `process.stdin.setEncoding('utf8')` must carry decoder state across chunks.
 * '€' is `e2 82 ac`; the case writes `[e2 82]` then `[ac]` through the parity
 * runner's stdin hook so both Node and rifty exercise their real stdin bridge.
 */
const c: ParityCase = {
  stdin: [new Uint8Array([0xe2, 0x82]), new Uint8Array([0xac])],
  expected: 'text:€',
  code: `
    const process = require('node:process');
    process.stdin.setEncoding('utf8');
    let out = '';
    process.stdin.on('data', (chunk) => { out += chunk; });
    process.stdin.on('end', () => { console.log('text:' + out); });
  `,
};

export default c;
