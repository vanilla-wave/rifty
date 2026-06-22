/**
 * VFS→isomorphic-git filesystem adapter. Exposes a rifty {@link Vfs} as the
 * `fs` object isomorphic-git expects (a `.promises` API).
 *
 * Fidelity caveats — the VFS has no symlink layer and no POSIX mode/exec-bit
 * (ADR-0050 / ADR-0167):
 *  - file mode is fixed `100644` (`100755` is not representable),
 *  - dir mode is fixed `040755`,
 *  - `symlink` loud-throws `EPERM`, `readlink` loud-throws `ENOENT`,
 *  - `chmod` is a no-op (nothing to mutate).
 *
 * `ino` is derived from the file's mtime (the VFS has no inode concept). This is
 * load-bearing for change-detection: isomorphic-git's racy-clean index shortcut
 * (`compareStats`) compares mtime only at SECOND granularity but compares `ino`
 * EXACTLY — so deriving `ino` from the full-precision mtime makes a sub-second
 * content edit visible (paired with the VFS's strictly-monotonic write mtime),
 * instead of being silently trusted as unchanged. See ADR-0167 +
 * packages/vfs/src/mtime-monotonic.test.ts.
 */
import type { Vfs } from '@riftydev/vfs';

/** Stat shape isomorphic-git consumes — POSIX fields + Node-style methods. */
export interface GitStat {
  type: 'file' | 'dir';
  mode: number;
  size: number;
  ino: number;
  mtimeMs: number;
  ctimeMs: number;
  uid: number;
  gid: number;
  dev: number;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

/** The `fs` object isomorphic-git binds to (`.promises` API only). */
export interface GitFs {
  promises: {
    // Node's fs.readFile accepts the encoding as EITHER a string (`'utf8'`) or an
    // options object (`{ encoding: 'utf8' }`); isomorphic-git's gitignore manager
    // uses the string form, so both must be honored (else ignore rules silently
    // never parse → `.gitignore` is ignored). See readFile impl below.
    readFile(p: string, opts?: { encoding?: 'utf8' } | 'utf8'): Promise<Uint8Array | string>;
    writeFile(p: string, data: Uint8Array | string, opts?: unknown): Promise<void>;
    unlink(p: string): Promise<void>;
    readdir(p: string): Promise<string[]>;
    mkdir(p: string): Promise<void>;
    rmdir(p: string): Promise<void>;
    stat(p: string): Promise<GitStat>;
    lstat(p: string): Promise<GitStat>;
    readlink(p: string): Promise<string>;
    symlink(target: string, p: string): Promise<void>;
    chmod(p: string, mode: number): Promise<void>;
  };
}

// VFS has no exec-bit; 100755 not representable (ADR-0167 caveat).
const FILE_MODE = 0o100644;
const DIR_MODE = 0o040755;

function makeStat(isDir: boolean, size: number, mtime: number, ino: number): GitStat {
  return {
    type: isDir ? 'dir' : 'file',
    mode: isDir ? DIR_MODE : FILE_MODE,
    size,
    ino,
    mtimeMs: mtime,
    ctimeMs: mtime,
    uid: 0,
    gid: 0,
    dev: 0,
    isFile: () => !isDir,
    isDirectory: () => isDir,
    isSymbolicLink: () => false,
  };
}

function makeError(message: string, code: string): Error & { code: string } {
  const e = new Error(message) as Error & { code: string };
  e.code = code;
  return e;
}

function enoent(p: string): Error & { code: string } {
  return makeError(`ENOENT: no such file or directory, '${p}'`, 'ENOENT');
}

const MAX_UINT32 = 2 ** 32;

/** ino derived from mtime — changes whenever content is (over)written. */
function mtimeToIno(mtime: number): number {
  return Math.floor(mtime) % MAX_UINT32;
}

export function vfsToGitFs(vfs: Vfs): GitFs {
  const stat = async (p: string): Promise<GitStat> => {
    if (!(await vfs.exists(p))) throw enoent(p);
    const s = await vfs.stat(p);
    return makeStat(s.isDirectory, s.size, s.mtime, mtimeToIno(s.mtime));
  };

  return {
    promises: {
      async readFile(p, opts) {
        if (!(await vfs.exists(p))) throw enoent(p);
        const bytes = await vfs.readFile(p);
        // Encoding may arrive as `'utf8'` OR `{ encoding: 'utf8' }` (both are valid
        // Node fs.readFile calls); iso-git's ignore manager passes the string form.
        const encoding = typeof opts === 'string' ? opts : opts?.encoding;
        return encoding === 'utf8' ? new TextDecoder().decode(bytes) : bytes;
      },
      async writeFile(p, data) {
        await vfs.writeFile(p, data);
      },
      async unlink(p) {
        await vfs.rm(p);
      },
      async readdir(p) {
        if (!(await vfs.exists(p))) throw enoent(p);
        return (await vfs.readdir(p)).map((d) => d.name);
      },
      async mkdir(p) {
        await vfs.mkdir(p);
      },
      async rmdir(p) {
        await vfs.rm(p, { recursive: false });
      },
      stat,
      lstat: stat,
      async readlink(p) {
        // No symlink layer — every path is a regular file/dir, never a link.
        throw enoent(p);
      },
      async symlink() {
        throw makeError('EPERM: symlink unsupported (VFS has no symlink layer)', 'EPERM');
      },
      async chmod() {
        // VFS has no POSIX mode — nothing to mutate.
      },
    },
  };
}
