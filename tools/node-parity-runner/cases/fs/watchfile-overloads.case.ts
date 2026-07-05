import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  setup: { files: { 'watched.txt': 'one' } },
  code: `
    const fs = require('node:fs');

    try {
      fs.watchFile('watched.txt', undefined, () => {});
      fs.unwatchFile('watched.txt');
      console.log('watchfile-undefined-options: ok');
    } catch (err) {
      console.log('watchfile-undefined-options:', err.code ?? err.name);
    }
  `,
};

export default c;
