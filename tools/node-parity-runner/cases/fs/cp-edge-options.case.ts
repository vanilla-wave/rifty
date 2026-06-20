import type { ParityCase } from '../../src/types.ts';

/**
 * `fs.cpSync` edge options: `filter` (skip an entry/subtree), `force:false`
 * (skip an existing dest), `errorOnExist` (throw `ERR_FS_CP_EEXIST`), and
 * `preserveTimestamps` (dest mtime = src mtime). rifty Stats exposes only
 * mtimeMs, so timestamps are checked there (Node mtimeMs = seconds × 1000).
 */
const c: ParityCase = {
  code: `
    const fs = require('node:fs');
    fs.mkdirSync('s', { recursive: true });
    fs.writeFileSync('s/keep.txt', 'K');
    fs.writeFileSync('s/skip.log', 'S');
    fs.cpSync('s', 'd_filter', { recursive: true, filter: (src) => !src.endsWith('.log') });
    console.log('FILTER', JSON.stringify({ keep: fs.existsSync('d_filter/keep.txt'), skip: fs.existsSync('d_filter/skip.log') }));

    fs.mkdirSync('d_force', { recursive: true });
    fs.writeFileSync('d_force/keep.txt', 'OLD');
    fs.cpSync('s', 'd_force', { recursive: true, force: false });
    console.log('FORCE_FALSE', JSON.stringify({ content: fs.readFileSync('d_force/keep.txt', 'utf8') }));

    fs.mkdirSync('d_eoe', { recursive: true });
    fs.writeFileSync('d_eoe/keep.txt', 'OLD');
    let e;
    try { fs.cpSync('s', 'd_eoe', { recursive: true, force: false, errorOnExist: true }); }
    catch (err) { e = { code: err.code }; }
    console.log('ERRORONEXIST', JSON.stringify(e));

    fs.writeFileSync('pt_src.txt', 'P');
    fs.utimesSync('pt_src.txt', 1111, 2222);
    fs.cpSync('pt_src.txt', 'pt_no.txt', {});
    fs.cpSync('pt_src.txt', 'pt_yes.txt', { preserveTimestamps: true });
    console.log('PT', JSON.stringify({
      srcMtimeMs: fs.statSync('pt_src.txt').mtimeMs,
      noEqSrc: fs.statSync('pt_no.txt').mtimeMs === fs.statSync('pt_src.txt').mtimeMs,
      yesMtimeMs: fs.statSync('pt_yes.txt').mtimeMs,
    }));
  `,
};

export default c;
