/**
 * FS_ERRNO must cover every code the VFS can emit (review 2026-07-05 handoff:
 * EPERM/EDQUOT/EIO crossed the boundary without errno/description). The
 * `Record<VfsErrorCode, true>` literal makes a VfsErrorCode union growth a
 * COMPILE error here, forcing the table update.
 */
import { VfsError, type VfsErrorCode } from '@riftydev/vfs';
import { describe, expect, it } from 'vitest';
import { FS_ERRNO, toNodeFsError } from './fs-errors.ts';

const ALL_VFS_CODES: Record<VfsErrorCode, true> = {
  ENOENT: true,
  EEXIST: true,
  EISDIR: true,
  ENOTDIR: true,
  ENOTEMPTY: true,
  EPERM: true,
  EINVAL: true,
  EACCES: true,
  EDQUOT: true,
  EIO: true,
};

describe('fs-errors errno table', () => {
  it('FS_ERRNO maps every VfsErrorCode (no bare-code Node errors)', () => {
    for (const code of Object.keys(ALL_VFS_CODES)) {
      expect(FS_ERRNO[code], `missing FS_ERRNO entry: ${code}`).toBeDefined();
    }
  });

  it('EPERM/EIO/EDQUOT translate with Node errno + message prose', () => {
    const cases: ReadonlyArray<[VfsErrorCode, number, string]> = [
      ['EPERM', -1, "EPERM: operation not permitted, open '/x'"],
      ['EIO', -5, "EIO: i/o error, open '/x'"],
      ['EDQUOT', -122, "EDQUOT: disk quota exceeded, open '/x'"],
    ];
    for (const [code, errno, message] of cases) {
      const err = toNodeFsError(new VfsError(code, '/x'), 'open', '/x') as NodeJS.ErrnoException;
      expect(err.code).toBe(code);
      expect(err.errno).toBe(errno);
      expect(err.syscall).toBe('open');
      expect(err.message).toBe(message);
    }
  });
});
