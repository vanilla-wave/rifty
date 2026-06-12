import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  setup: {
    files: {
      'base.txt': 'base',
    },
  },
  code: `
    const fs = require('node:fs');
    const fd = fs.openSync('created.txt', fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL);
    fs.writeSync(fd, Buffer.from('new'));
    fs.closeSync(fd);
    console.log(fs.readFileSync('created.txt', 'utf8'));
    try {
      fs.openSync('created.txt', fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL);
    } catch (err) {
      console.log(err.code);
    }
    fs.copyFileSync('base.txt', 'copied.txt', fs.constants.COPYFILE_EXCL);
    console.log(fs.readFileSync('copied.txt', 'utf8'));
    try {
      fs.copyFileSync('base.txt', 'copied.txt', fs.constants.COPYFILE_EXCL);
    } catch (err) {
      console.log(err.code);
    }
  `,
};

export default c;
