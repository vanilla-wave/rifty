import type { ParityCase } from '../../src/types.ts';

/**
 * `appendFileSync` still opens with the supplied flag. Non-append flags like
 * `r+` write from offset 0 and require the target to exist; they must not fall
 * into the default append/create path.
 */
const c: ParityCase = {
  cwd: '/app',
  setup: {
    files: {
      'app/existing.txt': 'abc',
    },
  },
  code: `
    const fs = require('node:fs');

    const probe = (label, fn) => {
      try {
        console.log(label + ': ' + JSON.stringify(fn()));
      } catch (e) {
        console.log(label + ': ' + e.code + ' ' + e.syscall + ' ' + JSON.stringify(e.path));
      }
    };

    probe('rplus-missing', () => {
      fs.appendFileSync('missing.txt', 'X', { flag: 'r+' });
      return fs.readFileSync('missing.txt', 'utf8');
    });

    fs.writeFileSync('existing.txt', 'abc');
    fs.appendFileSync('existing.txt', 'X', { flag: 'r+' });
    console.log('rplus-existing:', JSON.stringify(fs.readFileSync('existing.txt', 'utf8')));

    fs.writeFileSync('existing.txt', 'abc');
    fs.appendFileSync('existing.txt', 'X', { flag: 'a' });
    console.log('append-existing:', JSON.stringify(fs.readFileSync('existing.txt', 'utf8')));

    fs.writeFileSync('existing.txt', 'abc');
    fs.appendFileSync('existing.txt', 'X', { flag: 'w' });
    console.log('truncate-existing:', JSON.stringify(fs.readFileSync('existing.txt', 'utf8')));

    // writeFileSync honors the open flag the same way: 'r+' writes from
    // offset 0 WITHOUT truncating — the tail beyond the data survives
    // (review 2026-07-05 handoff; rifty used to overwrite the whole file).
    fs.writeFileSync('tail.txt', 'hello world tail');
    fs.writeFileSync('tail.txt', 'ABC', { flag: 'r+' });
    console.log('writefile-rplus-tail:', JSON.stringify(fs.readFileSync('tail.txt', 'utf8')));

    fs.writeFileSync('tail.txt', 'abc');
    fs.writeFileSync('tail.txt', 'XYZW', { flag: 'a' });
    console.log('writefile-a-appends:', JSON.stringify(fs.readFileSync('tail.txt', 'utf8')));
  `,
};

export default c;
