/**
 * Conformance for the symlink-shaped APIs in `node:fs`. We have no symlink
 * layer in the VFS (M9: in-memory + OPFS, no symlinks). Hard rule "no silent
 * stubs" — `lstatSync` and `realpathSync` MUST throw `NotImplementedError`
 * instead of pretending to succeed by aliasing `statSync` / `normalizePath`.
 *
 * Symlink support lands in M12; until then the call sites are visible.
 */
import { NotImplementedError } from '@rifty/io';
import { afterEach, describe, expect, it } from 'vitest';
import { resetSyncMirror } from './fs-sync-mirror.ts';
import { lstatSync, realpathSync, writeFileSync } from './fs.ts';

afterEach(() => resetSyncMirror());

describe('node:fs symlink APIs (no silent stubs)', () => {
  it('lstatSync throws NotImplementedError even for existing files', () => {
    writeFileSync('/exists.txt', 'data');
    expect(() => lstatSync('/exists.txt')).toThrow(NotImplementedError);
    expect(() => lstatSync('/exists.txt')).toThrow(/symlinks not supported/);
  });

  it('realpathSync throws NotImplementedError even for existing files', () => {
    writeFileSync('/exists.txt', 'data');
    expect(() => realpathSync('/exists.txt')).toThrow(NotImplementedError);
    expect(() => realpathSync('/exists.txt')).toThrow(/symlinks not supported/);
  });

  it('realpathSync.native also throws NotImplementedError', () => {
    writeFileSync('/exists.txt', 'data');
    expect(() => realpathSync.native('/exists.txt')).toThrow(NotImplementedError);
  });
});
