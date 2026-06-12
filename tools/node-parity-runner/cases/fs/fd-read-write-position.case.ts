import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  setup: {
    files: {
      'seed.txt': 'abcdef',
    },
  },
  code: `
    const fs = require('node:fs');
    const fd = fs.openSync('seed.txt', fs.constants.O_RDWR);
    const readBuf = Buffer.alloc(3);
    console.log(fs.readSync(fd, readBuf, 0, 3, 1));
    console.log(readBuf.toString('utf8'));
    console.log(fs.writeSync(fd, Buffer.from('XY'), 0, 2, 2));
    console.log(fs.readFileSync('seed.txt', 'utf8'));
    const seq = Buffer.alloc(2);
    console.log(fs.readSync(fd, seq, 0, 2, null));
    console.log(seq.toString('utf8'));
    fs.closeSync(fd);
  `,
};

export default c;
