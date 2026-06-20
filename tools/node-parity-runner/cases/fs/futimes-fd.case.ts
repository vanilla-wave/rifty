import type { ParityCase } from '../../src/types.ts';

/** `fs.futimesSync(fd, …)` resolves fd→path and delegates to utimes; `EBADF` (syscall `futime`) on a bad fd. */
const c: ParityCase = {
  code: `
    const fs = require('node:fs');
    fs.writeFileSync('fu.txt', 'F');
    const fd = fs.openSync('fu.txt', 'r+');
    fs.futimesSync(fd, 300, 400);
    console.log(JSON.stringify({ mtimeMs: fs.fstatSync(fd).mtimeMs, statMtimeMs: fs.statSync('fu.txt').mtimeMs }));
    fs.closeSync(fd);
    let e;
    try { fs.futimesSync(999999, 1, 2); } catch (err) { e = { code: err.code, syscall: err.syscall }; }
    console.log(JSON.stringify(e));
  `,
};

export default c;
