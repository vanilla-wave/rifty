import type { ParityCase } from '../../src/types.ts';

/**
 * A NUL in a path is Node's `nullCheck` (ERR_INVALID_ARG_VALUE, `existsSync`
 * false), and `utimes` never stores a non-finite time: an invalid Date leaves
 * the time as it was (libuv UTIME_OMIT), a negative number is now. A huge time
 * is platform-specific in Node (darwin saturates at 2^63 ns, Linux: EINVAL), so
 * it is not compared here (rifty saturates; the compat row names it). Found through the
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
    for (const [label, v] of [['negative string', '-5'], ['empty string', ''], ['decimal string', '12.5']]) {
      fs.utimesSync('f', v, v);
      console.log(label, fs.statSync('f').mtimeMs);
    }
    const t0 = Date.now();
    for (const v of ['Infinity', '-Infinity']) {
      fs.utimesSync('f', v, v);
      console.log(v, 'string is now', fs.statSync('f').mtimeMs >= t0);
    }
    try { fs.utimesSync('f', 'abc', 'abc'); } catch (e) { console.log('abc', e.code); }
    // Past a 64-bit nanosecond clock: Node's value is the platform's (darwin saturates,
    // Linux may refuse); only "finite and inside Date" is compared.
    for (const v of ['-1e306', '1e306', '-9.3e12', new Date(-8.64e15)]) {
      let finite;
      try { fs.utimesSync('f', v, v); finite = Number.isFinite(fs.statSync('f').mtimeMs) && Math.abs(fs.statSync('f').mtimeMs) <= 8.64e15; }
      catch { finite = true; }
      console.log(String(v).slice(0, 8), 'finite', finite);
    }
    for (const v of [NaN, Infinity]) {
      try { fs.utimesSync('f', v, v); } catch (e) { console.log('number', v, e.code); }
    }
  `,
};

export default c;
