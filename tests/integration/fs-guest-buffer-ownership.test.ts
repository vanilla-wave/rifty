/**
 * Store level of the guest-buffer ownership rows (parity case
 * `fs/write-read-buffer-ownership`): the bytes `MemoryFsSync` keeps for a guest
 * `node:fs` write are not the guest's memory, so a WASI process writing the
 * file in place (fd.ts reuses its fd image, a view of the store's bytes)
 * changes the file, never the JS program's buffer. In-process host: one store
 * behind both runtimes.
 */
import { afterEach, beforeEach, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from '../../packages/runtime-js/src/builtins/fs.ts';
import { fdSyscalls } from '../../packages/runtime-wasi/src/syscalls/fd.ts';
import { setupPathCtx } from '../../packages/runtime-wasi/src/syscalls/path-test-fixture.ts';
import {
  MemoryFsSync,
  resetSyncMirror,
  setSyncMirror,
} from '../../packages/vfs/src/internal/index.ts';

let store: MemoryFsSync;
beforeEach(() => {
  store = new MemoryFsSync();
  store.mkdirSync('/work', { recursive: true });
  setSyncMirror(store);
});
afterEach(() => resetSyncMirror());

it('the store keeps a copy of the guest buffer, not the buffer', () => {
  const guest = new Uint8Array([0, 1, 2, 3, 4]);
  writeFileSync('/work/f', guest.subarray(1, 4));
  guest.fill(9);
  expect([...store.readFileBytesSync('/work/f')]).toEqual([1, 2, 3]);
  const read = readFileSync('/work/f') as Uint8Array;
  read.fill(8);
  expect([...store.readFileBytesSync('/work/f')]).toEqual([1, 2, 3]);
});

it('a WASI in-place fd_write changes the file, not the JS buffer that wrote it', () => {
  const guest = new Uint8Array([1, 2, 3]);
  writeFileSync('/work/f', guest);
  const t = setupPathCtx();
  const fd = fdSyscalls(t.ctx) as unknown as {
    fd_write: (fd: number, iovs: number, iovsLen: number, nwritten: number) => number;
  };
  const len = t.writePath(100, 'f');
  // O_RDWR rights default; fd lands at offset 200.
  expect(t.ns.path_open(3, 0, 100, len, 0, 0n, 0n, 0, 200)).toBe(0);
  const wasiFd = t.readU32(200);
  new Uint8Array(t.memory.buffer).set([7], 400);
  const view = new DataView(t.memory.buffer);
  view.setUint32(300, 400, true);
  view.setUint32(304, 1, true);
  expect(fd.fd_write(wasiFd, 300, 1, 320)).toBe(0);
  expect([...(readFileSync('/work/f') as Uint8Array)]).toEqual([7, 2, 3]);
  expect([...guest]).toEqual([1, 2, 3]);
});
