import type { ParityCase } from '../../src/types.ts';

/**
 * Node error-object shape parity for the common fs failure paths: `code`,
 * `errno`, `syscall`, `path` (as-passed, NOT resolved), `dest` (two-path ops)
 * and the rendered `message`. Real libraries switch on `err.errno`/`err.syscall`
 * and parse the message — a raw `VfsError` leaking through (`ENOENT: /x`, no
 * errno/syscall) breaks them (review 2026-07-05).
 *
 * Only codes whose errno matches across linux/darwin appear here (ENOENT -2,
 * EEXIST -17, ENOTDIR -20, EISDIR -21, EINVAL -22) — ENOTEMPTY diverges
 * (-39/-66) and would make the case host-dependent. `realpath` prints no
 * path/message: Node absolutizes before failing, so the tmpdir would leak.
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
    const probe = (label, fields, fn) => {
      try {
        fn();
        console.log(label + ' | NO-THROW');
      } catch (e) {
        const parts = fields.map((f) => f + '=' + JSON.stringify(e[f]));
        console.log(label + ' | ' + parts.join(' '));
      }
    };
    const FULL = ['code', 'errno', 'syscall', 'path', 'message'];
    const DUAL = ['code', 'errno', 'syscall', 'path', 'dest', 'message'];

    probe('readFile-missing', FULL, () => fs.readFileSync('missing.txt'));
    probe('readFile-dir', FULL, () => fs.readFileSync('dir'));
    probe('readFile-notdir', FULL, () => fs.readFileSync('plain.txt/deep.txt'));
    probe('writeFile-missing-parent', FULL, () => fs.writeFileSync('nodir/f.txt', 'x'));
    probe('appendFile-missing-parent', FULL, () => fs.appendFileSync('nodir/a.log', 'x'));
    probe('readdir-missing', FULL, () => fs.readdirSync('missing-dir'));
    probe('readdir-file', FULL, () => fs.readdirSync('plain.txt'));
    probe('stat-missing', FULL, () => fs.statSync('missing.txt'));
    probe('stat-notdir', FULL, () => fs.statSync('plain.txt/deep.txt'));
    probe('lstat-missing', FULL, () => fs.lstatSync('missing.txt'));
    probe('mkdir-exists', FULL, () => fs.mkdirSync('dir'));
    probe('mkdir-through-file', FULL, () => fs.mkdirSync('plain.txt/sub'));
    probe('rmdir-file', FULL, () => fs.rmdirSync('plain.txt'));
    probe('rm-missing', FULL, () => fs.rmSync('missing.txt'));
    probe('unlink-missing', FULL, () => fs.unlinkSync('missing.txt'));
    probe('utimes-missing', FULL, () => fs.utimesSync('missing.txt', 1, 1));
    probe('readlink-plain-file', FULL, () => fs.readlinkSync('plain.txt'));
    probe('readlink-missing', FULL, () => fs.readlinkSync('missing.txt'));
    probe('readlink-notdir', FULL, () => fs.readlinkSync('plain.txt/deep'));
    probe('realpath-missing', ['code', 'errno', 'syscall'], () => fs.realpathSync('missing.txt'));
    probe('rename-missing-src', DUAL, () => fs.renameSync('missing.txt', 'dst.txt'));
    probe('copyFile-missing-src', DUAL, () => fs.copyFileSync('missing.txt', 'dst.txt'));
    probe('open-missing', FULL, () => fs.openSync('missing.txt', 'r'));
    probe('open-notdir', FULL, () => fs.openSync('plain.txt/deep', 'r'));
    probe('open-create-notdir', FULL, () => fs.openSync('plain.txt/deep', 'w'));
    probe('readFile-rplus-notdir', FULL, () => fs.readFileSync('plain.txt/deep', { flag: 'r+' }));
    probe('writeFile-rplus-notdir', FULL, () =>
      fs.writeFileSync('plain.txt/deep', 'x', { flag: 'r+' }));
    probe('appendFile-notdir', FULL, () => fs.appendFileSync('plain.txt/deep.log', 'x'));
    probe('cp-missing-src', DUAL, () => fs.cpSync('missing-dir', 'dst-dir', { recursive: true }));
    probe('opendir-missing', FULL, () => fs.opendirSync('missing-dir'));

    const fsp = require('node:fs/promises');
    const aprobe = async (label, fields, fn) => {
      try {
        await fn();
        console.log(label + ' | NO-THROW');
      } catch (e) {
        const parts = fields.map((f) => f + '=' + JSON.stringify(e[f]));
        console.log(label + ' | ' + parts.join(' '));
      }
    };
    (async () => {
      await aprobe('p.readFile-missing', FULL, () => fsp.readFile('missing.txt'));
      await aprobe('p.access-missing', FULL, () => fsp.access('missing.txt'));
      await aprobe('p.access-notdir', FULL, () => fsp.access('plain.txt/deep'));
      await aprobe('p.readlink-plain-file', FULL, () => fsp.readlink('plain.txt'));
      await aprobe('cb.readFile-missing', FULL, () => new Promise((res, rej) =>
        fs.readFile('missing.txt', (e) => (e ? rej(e) : res()))));
    })();
  `,
};

export default c;
