/**
 * Conformance for the symlink-shaped APIs in `node:fs`. The VFS has no symlink
 * layer (in-memory + OPFS — no symlinks until M12), so per ADR-0050 these are
 * the CORRECT POSIX semantics for a symlink-free filesystem, not silent stubs:
 *   - `lstat ≡ stat` (lstat differs from stat ONLY on symlinks);
 *   - `realpath ≡ normalise-if-exists` (canonicalise + ENOENT on a missing path);
 *   - `readlink` throws EINVAL (non-link) / ENOENT (missing) — never a fake target.
 * The non-existent-path ENOENT throw is the line that keeps this honest. The M9
 * loud-throw contract this replaces was moved forward by the Real Vite forcing
 * consumer (chokidar/readdirp call these on the happy path).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { resetSyncMirror } from './fs-sync-mirror.ts';
import { lstatSync, readlinkSync, realpathSync, statSync, writeFileSync } from './fs.ts';

afterEach(() => resetSyncMirror());

describe('node:fs symlink-shaped APIs (no-symlink VFS semantics, ADR-0050)', () => {
  it('lstatSync is identical to statSync and reports no symlink', () => {
    writeFileSync('/exists.txt', 'data');
    const ls = lstatSync('/exists.txt');
    const st = statSync('/exists.txt');
    expect(ls.isFile()).toBe(st.isFile());
    expect(ls.isDirectory()).toBe(st.isDirectory());
    expect(ls.size).toBe(st.size);
    expect(ls.isSymbolicLink()).toBe(false);
  });

  it('realpathSync canonicalises an existing path (collapses ./..), not identity', () => {
    writeFileSync('/exists.txt', 'data');
    expect(realpathSync('/./a/../exists.txt')).toBe('/exists.txt');
  });

  it('realpathSync throws ENOENT for a missing path (not a silent normalise)', () => {
    expect(() => realpathSync('/missing.txt')).toThrow(/ENOENT/);
    try {
      realpathSync('/missing.txt');
    } catch (e) {
      expect((e as { code?: string }).code).toBe('ENOENT');
    }
  });

  it('realpathSync.native aliases realpathSync', () => {
    writeFileSync('/exists.txt', 'data');
    expect(realpathSync.native('/exists.txt')).toBe(realpathSync('/exists.txt'));
  });

  it('readlinkSync keeps honest errors: EINVAL on a non-link, ENOENT on missing', () => {
    writeFileSync('/exists.txt', 'data');
    expect(() => readlinkSync('/exists.txt')).toThrow(/EINVAL/);
    expect(() => readlinkSync('/missing.txt')).toThrow(/ENOENT/);
  });
});
