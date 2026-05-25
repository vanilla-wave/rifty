/**
 * ADR-0019 conformance — `process.cwd()` / `process.chdir()`.
 *
 * The runtime cwd cell defaults to `/workspace`. `chdir()` validates the
 * target against the shared sync VFS (`syncMirror`), throwing Node-shape
 * `ENOENT` / `ENOTDIR` for invalid targets. Subsequent `cwd()` reflects the
 * resolved value.
 *
 * The kernel `ProcessRecord.cwd` field is exercised separately in the kernel
 * unit tests; until ADR-0011 lands the Worker reads its own cell rather than
 * the main-thread record.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { riftyProcess, setProcessCwd } from '../../../packages/runtime-js/src/builtins/process.ts';
import {
  MemoryFsSync,
  resetSyncMirror,
  setSyncMirror,
} from '../../../packages/vfs/src/internal/index.ts';

describe('process.cwd() / chdir() — ADR-0019', () => {
  let fs: MemoryFsSync;

  beforeEach(() => {
    fs = new MemoryFsSync();
    fs.mkdirSync('/workspace', { recursive: true });
    fs.mkdirSync('/workspace/src', { recursive: true });
    fs.mkdirSync('/tmp', { recursive: true });
    fs.writeFileSync('/workspace/pkg.json', new TextEncoder().encode('{}'));
    setSyncMirror(fs);
    setProcessCwd('/workspace');
  });

  afterEach(() => {
    resetSyncMirror();
    setProcessCwd('/workspace');
  });

  it('cwd() returns the default workspace anchor', () => {
    expect(riftyProcess.cwd()).toBe('/workspace');
  });

  it('chdir to an absolute existing directory updates cwd', () => {
    riftyProcess.chdir('/tmp');
    expect(riftyProcess.cwd()).toBe('/tmp');
  });

  it('chdir to a relative directory resolves against current cwd', () => {
    riftyProcess.chdir('src');
    expect(riftyProcess.cwd()).toBe('/workspace/src');
  });

  it('chdir to a missing path throws ENOENT', () => {
    expect(() => riftyProcess.chdir('/does/not/exist')).toThrow(
      expect.objectContaining({ code: 'ENOENT', syscall: 'chdir' }),
    );
    // Failure does not mutate the cell.
    expect(riftyProcess.cwd()).toBe('/workspace');
  });

  it('chdir to a regular file throws ENOTDIR', () => {
    expect(() => riftyProcess.chdir('/workspace/pkg.json')).toThrow(
      expect.objectContaining({ code: 'ENOTDIR', syscall: 'chdir' }),
    );
    expect(riftyProcess.cwd()).toBe('/workspace');
  });

  it('chdir rejects non-string input with ERR_INVALID_ARG_TYPE', () => {
    expect(() => (riftyProcess.chdir as (x: unknown) => void)(42)).toThrow(
      expect.objectContaining({ code: 'ERR_INVALID_ARG_TYPE' }),
    );
  });
});
