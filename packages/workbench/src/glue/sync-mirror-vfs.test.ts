import { syncMirror } from '@riftydev/vfs';
import { resetSyncMirror } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { SyncMirrorVfs } from './sync-mirror-vfs.ts';

describe('SyncMirrorVfs.writeFile — Node fs parity (sibling-drift contract vs MemoryVfs)', () => {
  it('rejects ENOENT on a missing parent — never auto-creates directories', async () => {
    // Review round 4: this vfs auto-mkdir'ed every write parent, so the
    // deferred no-mkdir trusted-stamp write (npm-shell-command) was only
    // proven on the strict MemoryVfs — in production a `rm -rf node_modules`
    // completing inside the check→write window was silently RESURRECTED as a
    // dir holding one trusted stamp. Real `fs.writeFile` ENOENTs; so must
    // every Vfs sibling.
    resetSyncMirror();
    const vfs = new SyncMirrorVfs();
    await expect(vfs.writeFile('/no-such-dir/file.txt', 'x')).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await vfs.exists('/no-such-dir')).toBe(false); // nothing resurrected
  });

  it('writes normally when the parent exists (mkdir is the caller’s explicit step)', async () => {
    resetSyncMirror();
    const vfs = new SyncMirrorVfs();
    await vfs.mkdir('/proj/sub', { recursive: true });
    await vfs.writeFile('/proj/sub/file.txt', 'ok');
    expect(await vfs.readFileText('/proj/sub/file.txt')).toBe('ok');
  });
});

describe('SyncMirrorVfs.openReadable', () => {
  it('streams bytes from the sync mirror in highWaterMark-sized chunks', async () => {
    resetSyncMirror();
    syncMirror().writeFileSync('/anything', new TextEncoder().encode('abcdef'));
    const vfs = new SyncMirrorVfs();
    const stream = await vfs.openReadable('/anything', { chunkSize: 2, start: 1, end: 5 });
    const reader = stream.getReader();

    const chunks: string[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(new TextDecoder().decode(value));
    }
    expect(chunks).toEqual(['bc', 'de']);
  });
});
