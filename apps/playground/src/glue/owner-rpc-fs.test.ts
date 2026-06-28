import { syncMirror } from '@riftydev/vfs';
import { resetSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFileAsync, renamePathAsync } from './fs-ops.ts';
import { OwnerRpcFs } from './owner-rpc-fs.ts';
import { SnapshotFs } from './snapshot-fs.ts';
import { SNAPSHOT_MAX_CONTENT_BYTES, collectSnapshot } from './vfs-snapshot-port.ts';
import { type VfsWriteFrame, applyVfsWriteFrame } from './vfs-write-port.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

function seed(path: string, text: string): void {
  const fs = syncMirror();
  const parent = path.slice(0, path.lastIndexOf('/'));
  fs.mkdirSync(parent, { recursive: true });
  fs.writeFileSync(path, enc.encode(text));
}

describe('OwnerRpcFs', () => {
  let snapshot: SnapshotFs;
  let frames: VfsWriteFrame[];
  let writer: { writeFrameAcked(frame: VfsWriteFrame): Promise<void> };

  beforeEach(() => {
    resetSyncMirror();
    syncMirror().mkdirSync('/workspace', { recursive: true });
    syncMirror().mkdirSync('/workspace/src', { recursive: true });
    snapshot = new SnapshotFs('/workspace');
    snapshot.update(collectSnapshot(syncMirror(), '/workspace'));
    frames = [];
    writer = {
      writeFrameAcked: (frame) => {
        frames.push(frame);
        return Promise.resolve();
      },
    };
  });

  afterEach(() => {
    resetSyncMirror();
  });

  function rpc(): OwnerRpcFs {
    return new OwnerRpcFs(snapshot, () => writer, { timeoutMs: 250 });
  }

  function publish(frame = frames.shift()): void {
    if (!frame) throw new Error('expected owner frame');
    applyVfsWriteFrame(frame);
    snapshot.update(collectSnapshot(syncMirror(), '/workspace'));
  }

  it('creates files and directories only after the owner republishes', async () => {
    const fs = rpc();

    const file = fs.createFile('/workspace/src/new.txt');
    expect(frames).toEqual([
      {
        type: 'write',
        path: '/workspace/src/new.txt',
        data: new Uint8Array(),
        recursive: false,
      },
    ]);
    expect(snapshot.existsSync('/workspace/src/new.txt')).toBe(false);
    publish();
    await file;
    expect(snapshot.statSync('/workspace/src/new.txt')).toMatchObject({ isFile: true, size: 0 });

    const dir = fs.createDir('/workspace/src/dir');
    expect(frames).toEqual([{ type: 'mkdir', path: '/workspace/src/dir', recursive: false }]);
    expect(snapshot.existsSync('/workspace/src/dir')).toBe(false);
    publish();
    await dir;
    expect(snapshot.statSync('/workspace/src/dir').isDirectory).toBe(true);
  });

  it('renames, copies, and deletes through owner frames reflected by SnapshotFs', async () => {
    seed('/workspace/src/a.txt', 'A');
    snapshot.update(collectSnapshot(syncMirror(), '/workspace'));
    const fs = rpc();

    const renamed = fs.renamePath('/workspace/src/a.txt', '/workspace/src/b.txt');
    expect(frames).toEqual([
      { type: 'rename', from: '/workspace/src/a.txt', to: '/workspace/src/b.txt' },
    ]);
    expect(snapshot.existsSync('/workspace/src/a.txt')).toBe(true);
    publish();
    await renamed;
    expect(snapshot.existsSync('/workspace/src/a.txt')).toBe(false);
    expect(dec.decode(snapshot.readFileBytesSync('/workspace/src/b.txt'))).toBe('A');

    const copied = fs.copyTree('/workspace/src/b.txt', '/workspace/src/c.txt');
    expect(frames).toEqual([
      { type: 'copy', from: '/workspace/src/b.txt', to: '/workspace/src/c.txt' },
    ]);
    publish();
    await copied;
    expect(dec.decode(snapshot.readFileBytesSync('/workspace/src/b.txt'))).toBe('A');
    expect(dec.decode(snapshot.readFileBytesSync('/workspace/src/c.txt'))).toBe('A');

    const deleted = fs.deletePath('/workspace/src/b.txt');
    expect(frames).toEqual([
      { type: 'rm', path: '/workspace/src/b.txt', recursive: true, force: false },
    ]);
    publish();
    await deleted;
    expect(snapshot.existsSync('/workspace/src/b.txt')).toBe(false);
    expect(snapshot.existsSync('/workspace/src/c.txt')).toBe(true);
  });

  it('coalesces multi-file renames and writes into one owner frame each', async () => {
    seed('/workspace/src/a.txt', 'A');
    seed('/workspace/src/b.txt', 'B');
    snapshot.update(collectSnapshot(syncMirror(), '/workspace'));
    const fs = rpc();

    const moved = fs.renameMany([
      { from: '/workspace/src/a.txt', to: '/workspace/lib/a.txt' },
      { from: '/workspace/src/b.txt', to: '/workspace/lib/b.txt' },
    ]);
    expect(frames).toEqual([
      {
        type: 'batch',
        frames: [
          { type: 'rename', from: '/workspace/src/a.txt', to: '/workspace/lib/a.txt' },
          { type: 'rename', from: '/workspace/src/b.txt', to: '/workspace/lib/b.txt' },
        ],
      },
    ]);
    publish();
    await moved;
    expect(snapshot.existsSync('/workspace/src/a.txt')).toBe(false);
    expect(snapshot.existsSync('/workspace/src/b.txt')).toBe(false);
    expect(dec.decode(snapshot.readFileBytesSync('/workspace/lib/a.txt'))).toBe('A');
    expect(dec.decode(snapshot.readFileBytesSync('/workspace/lib/b.txt'))).toBe('B');

    const data = [enc.encode('one'), enc.encode('two')];
    const uploaded = fs.writeFiles([
      { path: '/workspace/upload/one.bin', data: data[0]!, recursive: true },
      { path: '/workspace/upload/two.bin', data: data[1]!, recursive: true },
    ]);
    expect(frames).toEqual([
      {
        type: 'batch',
        frames: [
          { type: 'write', path: '/workspace/upload/one.bin', data: data[0]!, recursive: true },
          { type: 'write', path: '/workspace/upload/two.bin', data: data[1]!, recursive: true },
        ],
      },
    ]);
    publish();
    await uploaded;
    expect(dec.decode(snapshot.readFileBytesSync('/workspace/upload/one.bin'))).toBe('one');
    expect(dec.decode(snapshot.readFileBytesSync('/workspace/upload/two.bin'))).toBe('two');
  });

  it('binds async fs-ops helpers without making SnapshotFs writable', async () => {
    const fs = rpc();

    const created = createFileAsync(fs, '/workspace/helper.txt');
    publish();
    await created;

    const renamed = renamePathAsync(fs, '/workspace/helper.txt', '/workspace/helper-renamed.txt');
    publish();
    await renamed;

    expect(snapshot.existsSync('/workspace/helper-renamed.txt')).toBe(true);
    expect(() => snapshot.writeFileSync('/workspace/local.txt', enc.encode('x'))).toThrow(
      /read-only/,
    );
  });

  it('rejects owner-exit sends loudly and rebinds to the next owner handle', async () => {
    const fs = rpc();
    writer = {
      writeFrameAcked() {
        return Promise.reject(new Error('workspace owner has exited'));
      },
    };

    await expect(fs.createFile('/workspace/dead.txt')).rejects.toThrow(/owner has exited/);
    expect(snapshot.existsSync('/workspace/dead.txt')).toBe(false);

    writer = {
      writeFrameAcked: (frame) => {
        frames.push(frame);
        return Promise.resolve();
      },
    };
    const created = fs.createFile('/workspace/live.txt');
    expect(frames).toEqual([
      {
        type: 'write',
        path: '/workspace/live.txt',
        data: new Uint8Array(),
        recursive: false,
      },
    ]);
    publish();
    await created;
    expect(snapshot.existsSync('/workspace/live.txt')).toBe(true);
  });

  it('rejects when the owner accepts a frame but no snapshot ever reflects it', async () => {
    const fs = new OwnerRpcFs(snapshot, () => writer, { timeoutMs: 5 });

    const created = fs.createFile('/workspace/never-published.txt');

    expect(frames).toEqual([
      {
        type: 'write',
        path: '/workspace/never-published.txt',
        data: new Uint8Array(),
        recursive: false,
      },
    ]);
    await expect(created).rejects.toThrow(/did not reflect within 5ms/);
    expect(snapshot.existsSync('/workspace/never-published.txt')).toBe(false);
  });

  it('does not resolve a same-size write until a later owner snapshot publish is observed', async () => {
    seed('/workspace/src/same.txt', 'old');
    snapshot.update(collectSnapshot(syncMirror(), '/workspace'));
    const fs = rpc();

    let settled = false;
    const written = fs.writeFile('/workspace/src/same.txt', enc.encode('new'));
    written.then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    expect(dec.decode(snapshot.readFileBytesSync('/workspace/src/same.txt'))).toBe('old');
    publish();
    await written;
    expect(settled).toBe(true);
    expect(dec.decode(snapshot.readFileBytesSync('/workspace/src/same.txt'))).toBe('new');
  });

  it('writes binary bytes above the snapshot inline cap through the owner frame', async () => {
    const fs = rpc();
    const bytes = new Uint8Array(SNAPSHOT_MAX_CONTENT_BYTES + 3);
    bytes[0] = 0;
    bytes[bytes.length - 1] = 255;

    const written = fs.writeFile('/workspace/assets/large.bin', bytes, { recursive: true });
    expect(frames).toEqual([
      {
        type: 'write',
        path: '/workspace/assets/large.bin',
        data: bytes,
        recursive: true,
      },
    ]);
    publish();
    await written;

    const stored = syncMirror().readFileBytesSync('/workspace/assets/large.bin');
    expect(stored.byteLength).toBe(bytes.byteLength);
    expect(stored[0]).toBe(0);
    expect(stored.at(-1)).toBe(255);
  });

  it('surfaces owner-side apply errors instead of waiting for the reflect timeout', async () => {
    const fs = rpc();
    writer = {
      writeFrameAcked(frame) {
        frames.push(frame);
        return Promise.reject(new Error('"new.txt" already exists'));
      },
    };

    await expect(fs.createFile('/workspace/src/new.txt')).rejects.toThrow(/already exists/);
    expect(frames).toHaveLength(1);
  });
});
