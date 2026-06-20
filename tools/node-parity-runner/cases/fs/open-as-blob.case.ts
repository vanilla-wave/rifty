import type { ParityCase } from '../../src/types.ts';

/** `fs.openAsBlob(path[, { type }])` → resolved Blob; default `type` is `''`. */
const c: ParityCase = {
  code: `
    const fs = require('node:fs');
    (async () => {
      fs.writeFileSync('f.txt', 'hello blob');
      const b = await fs.openAsBlob('f.txt', { type: 'text/plain' });
      console.log('TYPE', JSON.stringify(b.type));
      console.log('SIZE', b.size);
      console.log('TEXT', JSON.stringify(await b.text()));
      console.log('IS_BLOB', b instanceof Blob);
      const b2 = await fs.openAsBlob('f.txt');
      console.log('DEFAULT_TYPE', JSON.stringify(b2.type));
      // Missing file → Node's generic ERR_INVALID_ARG_VALUE, not the raw ENOENT.
      try { await fs.openAsBlob('nope.txt'); console.log('MISSING', 'NO_THROW'); }
      catch (e) { console.log('MISSING', e.code); }
    })();
  `,
};

export default c;
