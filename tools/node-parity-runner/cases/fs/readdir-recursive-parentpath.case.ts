import type { ParityCase } from '../../src/types.ts';

/**
 * `fs.readdirSync(p, { recursive: true })` — Node-identical breadth-first full-
 * tree walk returning relative paths; coupled with `Dirent.parentPath` (echoes
 * the dir arg joined with the containing subdir). Node v24 removed the deprecated
 * `Dirent.path` alias, so it must be absent here too.
 */
const c: ParityCase = {
  code: `
    const fs = require('node:fs');
    fs.mkdirSync('R/A/A1', { recursive: true });
    fs.mkdirSync('R/B/B1', { recursive: true });
    fs.writeFileSync('R/z.txt', '');
    fs.writeFileSync('R/A/a.txt', '');
    fs.writeFileSync('R/A/A1/deepA.txt', '');
    fs.writeFileSync('R/B/b.txt', '');
    fs.writeFileSync('R/B/B1/deepB.txt', '');
    console.log(JSON.stringify(fs.readdirSync('R', { recursive: true })));
    const ents = fs.readdirSync('R', { recursive: true, withFileTypes: true });
    console.log(JSON.stringify(ents.map((e) => ({ n: e.name, pp: e.parentPath, d: e.isDirectory() }))));
    const one = fs.readdirSync('R', { withFileTypes: true })[0];
    console.log('hasPathOwn', Object.prototype.hasOwnProperty.call(one, 'path'), 'pathType', typeof one.path);
  `,
};

export default c;
