import { syncMirror } from '@riftydev/vfs';
import { resetSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installNodeEntryRemoteFs } from './node-entry-remote-fs.ts';

const ROOT = '/.rifty/workbench/v1/projects/project-a/tree';

describe('node-entry remote FS namespace', () => {
  afterEach(() => resetSyncMirror());

  it('installs a project-rooted guest view while retaining the unrooted relay view', () => {
    const call = vi.fn(() => true);
    const relay = installNodeEntryRemoteFs(call, ROOT);

    expect(syncMirror().existsSync('/src/main.js')).toBe(true);
    expect(call).toHaveBeenLastCalledWith('fs.exists', { path: `${ROOT}/src/main.js` });

    relay.existsSync(`${ROOT}/src/main.js`);
    expect(call).toHaveBeenLastCalledWith('fs.exists', { path: `${ROOT}/src/main.js` });
  });

  it('preserves the global remote view when no project root was supplied', () => {
    const call = vi.fn(() => true);
    const relay = installNodeEntryRemoteFs(call);

    expect(syncMirror()).toBe(relay);
    syncMirror().existsSync('/workspace/main.js');
    expect(call).toHaveBeenLastCalledWith('fs.exists', { path: '/workspace/main.js' });
  });
});
