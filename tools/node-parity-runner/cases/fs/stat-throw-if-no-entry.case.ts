import type { ParityCase } from '../../src/types.ts';

/**
 * `fs.statSync(path, { throwIfNoEntry: false })` parity (Node v24).
 *
 * A missing path returns `undefined` (not a thrown `ENOENT`) when
 * `throwIfNoEntry: false`; without the option it throws `ENOENT`; a present file
 * returns a `Stats`. Real packages use the `?? undefined` idiom to probe for a
 * file without try/catch — e.g. opencode's `Filesystem.stat` →
 * `Filesystem.stat(shell)?.isFile()` in shell-tool resolution. rifty previously
 * ignored the option and always threw, 500-ing the opencode prompt path.
 */
const c: ParityCase = {
  expected: ['undef:true', 'throws:ENOENT', 'present-isFile:true'].join('\n'),
  code: `
    const fs = require('node:fs');
    const miss = 'no-such-dir-xyz/missing.txt';
    console.log('undef:' + (fs.statSync(miss, { throwIfNoEntry: false }) === undefined));
    let code = 'none';
    try { fs.statSync(miss); } catch (e) { code = e && e.code; }
    console.log('throws:' + code);
    fs.writeFileSync('present.txt', 'hi');
    const s = fs.statSync('present.txt', { throwIfNoEntry: false });
    console.log('present-isFile:' + (s && s.isFile()));
  `,
};

export default c;
