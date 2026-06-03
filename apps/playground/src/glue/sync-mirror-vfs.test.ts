/**
 * Unit test for `SyncMirrorVfs.openReadable` — pinned to throw
 * `NotImplementedError` (and never a bare `Error`) so the gap is loud and
 * matches the CLAUDE.md "no silent stubs" hard rule.
 *
 * Streaming through the sync mirror is blocked on ADR-0014 (split VFS); the
 * unimplemented call MUST surface as a structured error so callers can branch.
 */
import { NotImplementedError } from '@riftydev/vfs';
import { describe, expect, it } from 'vitest';
import { SyncMirrorVfs } from './sync-mirror-vfs.ts';

describe('SyncMirrorVfs.openReadable', () => {
  it('throws NotImplementedError tagged with the feature name', async () => {
    const vfs = new SyncMirrorVfs();
    await expect(vfs.openReadable('/anything')).rejects.toBeInstanceOf(NotImplementedError);
    await expect(vfs.openReadable('/anything')).rejects.toMatchObject({
      feature: 'SyncMirrorVfs.openReadable',
    });
  });
});
