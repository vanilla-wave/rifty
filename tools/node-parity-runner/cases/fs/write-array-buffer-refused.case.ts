import type { ParityCase } from '../../src/types.ts';

/**
 * An ArrayBuffer or SharedArrayBuffer as write `data` is Node's
 * ERR_INVALID_ARG_TYPE and creates nothing. Declared ≠ Node: callback
 * `writeFile` delivers it to the callback (Node throws), `writeSync`/`write`
 * throw without a code (backlog runtime-js/fs-write-data-argument-types).
 */
const c: ParityCase = {
  code: `
    const fs = require('node:fs');
    const exists = (p) => fs.existsSync(p);
    (async () => {
      for (const [name, data] of [['ArrayBuffer', new ArrayBuffer(3)], ['SharedArrayBuffer', new SharedArrayBuffer(3)]]) {
        for (const [entry, write] of [
          ['writeFileSync', (p) => fs.writeFileSync(p, data)],
          ['appendFileSync', (p) => fs.appendFileSync(p, data)],
          ['writeFileSync wx', (p) => fs.writeFileSync(p, data, { flag: 'wx' })],
          ['promises.writeFile', (p) => fs.promises.writeFile(p, data)],
          ['promises.appendFile', (p) => fs.promises.appendFile(p, data)],
        ]) {
          const p = entry.replace(/\\W/g, '') + name;
          try {
            await write(p);
            console.log(entry, name, 'wrote', exists(p));
          } catch (e) {
            console.log(entry, name, e.name, e.code, e.message, 'file', exists(p));
          }
        }
      }
    })();
  `,
};

export default c;
