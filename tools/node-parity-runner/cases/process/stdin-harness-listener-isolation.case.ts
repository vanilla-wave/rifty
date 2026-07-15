import type { ParityCase } from '../../src/types.ts';

/** Feed completion must survive removal of every guest-observable end listener. */
const c: ParityCase = {
  stdin: [new Uint8Array([0x78])],
  expected: 'data:x',
  code: `
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => console.log('data:' + chunk));
    process.stdin.removeAllListeners('end');
    process.stdin.resume();
  `,
};

export default c;
