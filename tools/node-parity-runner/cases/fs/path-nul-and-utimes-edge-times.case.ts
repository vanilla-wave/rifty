import type { ParityCase } from '../../src/types.ts';

/**
 * A NUL in a path is Node's `nullCheck` (ERR_INVALID_ARG_VALUE, `existsSync`
 * false), and `utimes` never stores a non-finite time: an invalid Date leaves
 * the time as it was (libuv UTIME_OMIT), a negative number is now. A huge time
 * is platform-specific in Node (darwin saturates at 2^63 ns, Linux: EINVAL), so
 * it is not compared here (rifty saturates; compat ⚠️). Found through the
 * isolate sandbox (ADR-0568).
 */
const c: ParityCase = {
  cwd: '/app',
  setup: { files: { 'app/f': 'x' } },
  code: `
    const fs = require('node:fs');
    for (const [label, fn] of [
      ['write', () => fs.writeFileSync('a\\0b', 'x')],
      ['read', () => fs.readFileSync('a\\0b')],
      ['mkdir', () => fs.mkdirSync('d\\0')],
    ]) {
      try { fn(); console.log(label, 'ok'); } catch (e) { console.log(label, e.code, e.message); }
    }
    console.log('exists', fs.existsSync('a\\0b'), JSON.stringify(fs.readdirSync('.')));
    fs.utimesSync('f', 1000, 2000);
    fs.utimesSync('f', new Date(NaN), new Date(NaN));
    console.log('invalid date keeps', fs.statSync('f').mtimeMs === 2000000);
    const before = Date.now();
    fs.utimesSync('f', -5, -5);
    console.log('negative is now', fs.statSync('f').mtimeMs >= before);
    for (const v of [NaN, Infinity]) {
      try { fs.utimesSync('f', v, v); } catch (e) { console.log('number', v, e.code); }
    }
  `,
};

export default c;
