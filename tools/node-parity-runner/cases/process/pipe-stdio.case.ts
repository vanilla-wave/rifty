import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  stdin: [],
  code: `
    const { Readable, Writable } = require('node:stream');
    const process = require('node:process');
    Readable.from(['piped|']).pipe(process.stdout);
    Readable.from(['hidden']).pipe(process.stderr, { end: true });
    const dest = new Writable({ write(chunk, encoding, cb) { cb(); } });
    dest.on('finish', () => console.log('ordinary-finish'));
    Readable.from(['ordinary']).pipe(dest);
    setTimeout(() => process.stdout.write('still-open'), 20);
  `,
};

export default c;
