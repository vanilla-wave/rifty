import { syncMirror } from '@riftydev/vfs';
import { resetSyncMirror } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { SyncMirrorVfs } from './sync-mirror-vfs.ts';

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
