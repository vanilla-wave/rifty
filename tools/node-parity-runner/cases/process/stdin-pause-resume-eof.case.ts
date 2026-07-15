import type { ParityCase } from '../../src/types.ts';

/** Flow control and EOF must preserve split UTF-8 ordering exactly like Node. */
const c: ParityCase = {
  stdin: [new Uint8Array([0xe2, 0x82]), new Uint8Array([0xac])],
  expected: 'resume|data:€|end',
  code: `
    const process = require('node:process');
    const events = [];
    process.stdin.setEncoding('utf8');
    process.stdin.pause();
    process.stdin.on('data', (chunk) => events.push('data:' + chunk));
    process.stdin.on('end', () => {
      events.push('end');
      console.log(events.join('|'));
    });
    setTimeout(() => {
      events.push('resume');
      process.stdin.resume();
    }, 20);
  `,
};

export default c;
