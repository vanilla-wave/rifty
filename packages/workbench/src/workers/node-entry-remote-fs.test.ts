import { syncMirror } from '@riftydev/vfs';
import { resetSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installNodeEntryRemoteFs } from './node-entry-remote-fs.ts';

const ROOT = '/.rifty/workbench/v1/projects/project-a/tree';

describe('node-entry remote FS namespace', () => {
  afterEach(() => resetSyncMirror());

  it('installs a project-rooted guest view while retaining the unrooted relay view', () => {
    const call = vi.fn(() => {
      throw new Error('hot exists must not use JSON');
    });
    const callBinary = vi.fn(() => true);
    const install = installNodeEntryRemoteFs as unknown as (
      jsonCall: typeof call,
      binaryCall: typeof callBinary,
      remoteFsRoot?: string,
    ) => ReturnType<typeof installNodeEntryRemoteFs>;
    const relay = install(call, callBinary, ROOT);

    expect(syncMirror().existsSync('/src/main.js')).toBe(true);
    expect(callBinary).toHaveBeenLastCalledWith(
      'fs.exists',
      new TextEncoder().encode(`${ROOT}/src/main.js`),
    );

    relay.existsSync(`${ROOT}/src/main.js`);
    expect(callBinary).toHaveBeenLastCalledWith(
      'fs.exists',
      new TextEncoder().encode(`${ROOT}/src/main.js`),
    );
    expect(call).not.toHaveBeenCalled();
  });

  it('preserves the global remote view when no project root was supplied', () => {
    const call = vi.fn(() => {
      throw new Error('hot exists must not use JSON');
    });
    const callBinary = vi.fn(() => true);
    const install = installNodeEntryRemoteFs as unknown as (
      jsonCall: typeof call,
      binaryCall: typeof callBinary,
    ) => ReturnType<typeof installNodeEntryRemoteFs>;
    const relay = install(call, callBinary);

    expect(syncMirror()).toBe(relay);
    syncMirror().existsSync('/workspace/main.js');
    expect(callBinary).toHaveBeenLastCalledWith(
      'fs.exists',
      new TextEncoder().encode('/workspace/main.js'),
    );
    expect(call).not.toHaveBeenCalled();
  });
});
