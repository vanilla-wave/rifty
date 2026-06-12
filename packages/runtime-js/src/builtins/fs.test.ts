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
import { lstatSync, mkdirSync, readlinkSync, realpathSync, statSync, writeFileSync } from './fs.ts';
import { setProcessCwd } from './process.ts';

afterEach(() => {
  resetSyncMirror();
  setProcessCwd('/workspace'); // restore the default cwd cell after cwd tests
});

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

describe('resolvePath relative branch against a non-root cwd (#6)', () => {
  // Guards #6: dropping the outer `normalizePath` in resolvePath's relative
  // branch (joinPath already normalizes) keeps relative + dot-segment
  // resolution correct against a non-`/` cwd.
  it('resolves bare and dotted relative paths to the same file under cwd=/proj', () => {
    setProcessCwd('/proj');
    mkdirSync('/proj', { recursive: true });
    writeFileSync('a.txt', 'x'); // relative — anchors at /proj
    expect(statSync('a.txt').size).toBe(1);
    expect(statSync('./sub/../a.txt').size).toBe(1);
    expect(statSync('/proj/a.txt').size).toBe(1);
  });
});

describe('require("fs") module object exposes the stream factories', () => {
  // Regression: createReadStream/createWriteStream were named ESM exports but
  // missing from the default module object the builtin registry serves — so
  // `require('fs').createReadStream` (serve-static/send under express.static)
  // was undefined while the ESM named import worked.
  it('default fs object carries createReadStream/createWriteStream', async () => {
    const fs = (await import('./fs.ts')).default as Record<string, unknown>;
    expect(typeof fs.createReadStream).toBe('function');
    expect(typeof fs.createWriteStream).toBe('function');
  });
});

describe('fs stream classes are exposed for instanceof probes', () => {
  // send/destroy does `stream instanceof fs.ReadStream` on cleanup; an absent
  // class made that probe THROW (instanceof undefined) on every static file
  // teardown in the express demo.
  it('ReadStream/WriteStream classes exist and instanceof works', async () => {
    const fs = (await import('./fs.ts')).default as Record<string, unknown> & {
      createReadStream: (p: string) => unknown;
      ReadStream: new (...args: never[]) => unknown;
      WriteStream: new (...args: never[]) => unknown;
    };
    expect(typeof fs.ReadStream).toBe('function');
    expect(typeof fs.WriteStream).toBe('function');
    writeFileSync('/probe.txt', 'x');
    expect(fs.createReadStream('/probe.txt') instanceof fs.ReadStream).toBe(true);
  });
});
