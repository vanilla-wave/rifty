import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const fs = require('node:fs');
    fs.mkdirSync('tmp');
    const dir = fs.mkdtempSync('tmp/rifty-');
    console.log(dir.startsWith('tmp/rifty-'));
    fs.writeFileSync(dir + '/b.txt', 'b');
    fs.writeFileSync(dir + '/a.txt', 'a');
    const opened = fs.opendirSync(dir);
    const names = [opened.readSync().name, opened.readSync().name].sort();
    console.log(names[0]);
    console.log(names[1]);
    console.log(opened.readSync());
    opened.closeSync();
    fs.truncateSync(dir + '/a.txt', 3);
    console.log(fs.readFileSync(dir + '/a.txt').toString('hex'));
  `,
};

export default c;
