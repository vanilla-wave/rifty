import type { ParityCase } from '../../src/types.ts';

/**
 * `utimesSync`/`lutimesSync`/`futimesSync` time-arg validation (Node's `toUnixTimestamp`):
 * a numeric string coerces, a finite number is seconds; `NaN`/`Infinity`/non-numeric
 * string are `ERR_INVALID_ARG_TYPE` — never a silent `NaN` handed to the VFS clock.
 */
const c: ParityCase = {
  code: `
    const fs = require('node:fs');
    fs.writeFileSync('uv.txt', 'x');
    const fd = fs.openSync('uv.txt', 'r+');
    const v = (n, fn) => { try { fn(); console.log(n, 'OK'); } catch (e) { console.log(n, e.code); } };
    v('utimes.numstr', () => fs.utimesSync('uv.txt', '123', '123'));
    v('utimes.abc',    () => fs.utimesSync('uv.txt', 'abc', 1));
    v('utimes.nan',    () => fs.utimesSync('uv.txt', NaN, 1));
    v('utimes.inf',    () => fs.utimesSync('uv.txt', Infinity, 1));
    v('lutimes.abc',   () => fs.lutimesSync('uv.txt', 'abc', 1));
    v('futimes.abc',   () => fs.futimesSync(fd, 'abc', 1));
    v('futimes.nan',   () => fs.futimesSync(fd, NaN, 1));
    fs.closeSync(fd);
  `,
};

export default c;
