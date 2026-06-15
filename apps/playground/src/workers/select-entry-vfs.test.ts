import { SyncRpcFsSync } from '@riftydev/runtime-js';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { selectEntryVfs } from './select-entry-vfs.ts';

describe('selectEntryVfs', () => {
  it('returns a SyncRpcFsSync when remote-fs is enabled and a sync call exists', () => {
    const vfs = selectEntryVfs({
      remoteFs: true,
      call: () => undefined,
      localVfs: () => new MemoryFsSync(),
    });
    expect(vfs).toBeInstanceOf(SyncRpcFsSync);
  });
  it('falls back to the local mirror when remote-fs is off', () => {
    const local = new MemoryFsSync();
    expect(selectEntryVfs({ remoteFs: false, call: null, localVfs: () => local })).toBe(local);
  });
  it('throws loudly when remote-fs is requested but no sync call was published', () => {
    expect(() =>
      selectEntryVfs({ remoteFs: true, call: null, localVfs: () => new MemoryFsSync() }),
    ).toThrow(/sync call/i);
  });
});
