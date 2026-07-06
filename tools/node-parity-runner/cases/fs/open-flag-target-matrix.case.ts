import type { ParityCase } from '../../src/types.ts';

/**
 * open(2) flag×target error matrix — structural kill for the
 * `observable-order` axis at the open boundary. PR #115 review rounds kept
 * finding single cells (EISDIR-at-open, `'ax'` EEXIST-before-EISDIR, `EINVAL`
 * for `O_CREAT|O_DIRECTORY`); this pins the WHOLE lattice against real Node:
 * every string flag × {existing file, existing dir, missing} plus the numeric
 * `O_DIRECTORY` combos. `O_CREAT|O_DIRECTORY` is `EINVAL` before ANY target
 * inspection on both linux and darwin (probed node v24 on both); the printed
 * codes (EINVAL/EEXIST/ENOENT/EISDIR/ENOTDIR) share errno across hosts.
 */
const c: ParityCase = {
  cwd: '/app',
  setup: {
    files: {
      'app/plain.txt': 'x',
      'app/dir/keep.txt': 'k',
    },
  },
  code: `
    const fs = require('node:fs');
    const C = fs.constants;
    let n = 0;
    const probe = (label, fn) => {
      try {
        fs.closeSync(fn());
        console.log(label + ' | OK');
      } catch (e) {
        console.log(label + ' | code=' + e.code + ' errno=' + e.errno + ' syscall=' + e.syscall);
      }
    };
    const flags = ['r', 'r+', 'w', 'wx', 'w+', 'wx+', 'a', 'ax', 'a+', 'ax+'];
    for (const flag of flags) probe('file ' + flag, () => fs.openSync('plain.txt', flag));
    for (const flag of flags) probe('dir ' + flag, () => fs.openSync('dir', flag));
    // Fresh target per create-capable flag so an earlier probe's created file
    // cannot leak existence into a later cell.
    for (const flag of flags) probe('missing ' + flag, () => fs.openSync('m' + n++ + '.txt', flag));
    const D = C.O_DIRECTORY;
    for (const [tl, t] of [['file', 'plain.txt'], ['dir', 'dir'], ['missing', 'm-cd.txt']]) {
      probe('C|D rdonly ' + tl, () => fs.openSync(t, C.O_RDONLY | C.O_CREAT | D));
      probe('C|D|EXCL ' + tl, () => fs.openSync(t, C.O_RDONLY | C.O_CREAT | C.O_EXCL | D));
    }
    probe('D rdonly file', () => fs.openSync('plain.txt', C.O_RDONLY | D));
    probe('D rdonly dir', () => fs.openSync('dir', C.O_RDONLY | D));
    probe('D rdonly missing', () => fs.openSync('m-d.txt', C.O_RDONLY | D));
    probe('D wronly dir', () => fs.openSync('dir', C.O_WRONLY | D));
  `,
};

export default c;
