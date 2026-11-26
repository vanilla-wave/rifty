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

it('every write entry hands the store bytes of its own, never a guest object or its memory', async () => {
  const fs = (await import('../../packages/runtime-js/src/builtins/fs.ts')).default;
  const handed: unknown[] = [];
  class Recording extends MemoryFsSync {
    override writeFileSync(path: string, data: Uint8Array): void {
      handed.push(data);
      super.writeFileSync(path, data);
    }
  }
  const recording = new Recording();
  recording.mkdirSync('/work', { recursive: true });
  setSyncMirror(recording);
  const shared = new Uint8Array(new SharedArrayBuffer(4));
  const guests: Record<string, () => unknown> = {
    Uint8Array: () => new Uint8Array([1, 2, 3]),
    'Uint16Array subarray': () => new Uint16Array([1, 2, 3, 4]).subarray(1, 3),
    DataView: () => new DataView(new Uint8Array([1, 2, 3]).buffer, 1),
    'SharedArrayBuffer view': () => shared,
    Array: () => [1, 2, 3],
    'array-like object': () => ({ length: 2, 0: 1, 1: 2 }),
    'String object': () => new String('s'),
  };
  const done = (resolve: () => void) => () => resolve();
  const entries: Record<string, (p: string, v: never) => unknown> = {
    writeFileSync: (p, v) => fs.writeFileSync(p, v),
    'writeFileSync wx': (p, v) => fs.writeFileSync(p, v, { flag: 'wx' }),
    'writeFileSync r+': (p, v) => {
      fs.writeFileSync(p, 'zzzzzz');
      fs.writeFileSync(p, v, { flag: 'r+' });
    },
    appendFileSync: (p, v) => {
      fs.writeFileSync(p, 'z');
      fs.appendFileSync(p, v);
    },
    'promises.writeFile': (p, v) => fs.promises.writeFile(p, v),
    'promises.appendFile': (p, v) => fs.promises.appendFile(p, v),
    'writeFile cb': (p, v) => new Promise<void>((r) => fs.writeFile(p, v, done(r))),
    writeSync: (p, v) => {
      const fd = fs.openSync(p, 'w');
      try {
        if (ArrayBuffer.isView(v)) fs.writeSync(fd, v);
      } finally {
        fs.closeSync(fd);
      }
    },
    WriteStream: (p, v) =>
      new Promise<void>((r) => {
        if (!ArrayBuffer.isView(v)) return r();
        fs.createWriteStream(p).end(v, done(r));
      }),
  };
  let n = 0;
  for (const [guestName, make] of Object.entries(guests)) {
    for (const [entry, write] of Object.entries(entries)) {
      const guest = make();
      handed.length = 0;
      await write(`/work/f${n++}`, guest as never);
      for (const data of handed) {
        const label = `${entry} ← ${guestName}`;
        expect(data, label).not.toBe(guest);
        expect(data, label).toBeInstanceOf(Uint8Array);
        if (ArrayBuffer.isView(guest))
          expect((data as Uint8Array).buffer, label).not.toBe(guest.buffer);
      }
    }
  }
});
