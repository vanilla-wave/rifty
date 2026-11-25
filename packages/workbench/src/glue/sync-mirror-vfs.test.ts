import { syncMirror } from '@riftydev/vfs';
import { resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
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

describe('SyncMirrorVfs.openReadable by range (ADR-0576)', () => {
  const pattern = (size: number) => Uint8Array.from({ length: size }, (_, i) => (i * 11) % 251);

  async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array[]> {
    const chunks: Uint8Array[] = [];
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return chunks;
      chunks.push(value);
    }
  }

  // createReadStream({ end: MAX_SAFE_INTEGER }) passes the exclusive end 2^53.
  it('an exclusive end of 2^53 reads the whole file, as Node createReadStream', async () => {
    resetSyncMirror();
    syncMirror().writeFileSync('/f.bin', pattern(1000));
    const stream = await new SyncMirrorVfs().openReadable('/f.bin', {
      end: Number.MAX_SAFE_INTEGER + 1,
    });
    expect(Buffer.concat(await drain(stream))).toEqual(Buffer.from(pattern(1000)));
  });

  it('only its window leaves the mirror, once, and is streamed without a copy of its own', async () => {
    resetSyncMirror();
    const inner = syncMirror();
    inner.writeFileSync('/big.bin', pattern(1 << 20));
    const returned: Uint8Array[] = [];
    setSyncMirror(
      new Proxy(inner, {
        get(target, key) {
          const value = Reflect.get(target, key, target);
          if (typeof value !== 'function') return value;
          return (...args: unknown[]) => {
            const result = value.apply(target, args);
            if (result instanceof Uint8Array) returned.push(result);
            return result;
          };
        },
      }),
    );
    const start = 100;
    const end = start + 300 * 1024;
    const stream = await new SyncMirrorVfs().openReadable('/big.bin', {
      start,
      end,
      chunkSize: 64 * 1024,
    });
    const chunks = await drain(stream);
    expect(Buffer.concat(chunks)).toEqual(Buffer.from(pattern(1 << 20).subarray(start, end)));
    expect(returned.map((bytes) => bytes.byteLength)).toEqual([end - start]);
    for (const chunk of chunks) expect(chunk.buffer).toBe(returned[0]?.buffer);
  });

  // A stream reads the snapshot taken at open, as on main (live reads: unit 9r,
  // `fs-read-stream-reads-snapshot-not-open-file`).
  it.each([
    ['unlink', () => syncMirror().rmSync('/s.bin', {})],
    [
      'rename over',
      () => {
        syncMirror().writeFileSync('/other.bin', new Uint8Array(200 * 1024).fill(9));
        syncMirror().renameSync('/other.bin', '/s.bin');
      },
    ],
    [
      'same-size rewrite',
      () => syncMirror().writeFileSync('/s.bin', new Uint8Array(200 * 1024).fill(7)),
    ],
  ])('%s mid-stream: the whole old file, as on main', async (_name, mutate) => {
    resetSyncMirror();
    const original = pattern(200 * 1024);
    syncMirror().writeFileSync('/s.bin', original);
    const stream = await new SyncMirrorVfs().openReadable('/s.bin', { chunkSize: 64 * 1024 });
    const reader = stream.getReader();
    const first = await reader.read();
    mutate();
    const chunks = [first.value as Uint8Array];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    expect(Buffer.concat(chunks)).toEqual(Buffer.from(original));
  });

  it('validates its window as MemoryVfs/OpfsVfs do', async () => {
    resetSyncMirror();
    syncMirror().writeFileSync('/w.bin', pattern(10));
    const vfs = new SyncMirrorVfs();
    await expect(vfs.openReadable('/w.bin', { chunkSize: 0 })).rejects.toThrow(RangeError);
    await expect(vfs.openReadable('/w.bin', { start: 5, end: 2 })).rejects.toThrow(RangeError);
    await expect(vfs.openReadable('/w.bin', { start: -1 })).rejects.toThrow(RangeError);
    await expect(vfs.openReadable('/w.bin', { start: 1.5 })).rejects.toThrow(RangeError);
  });

  it('a missing file fails at open', async () => {
    resetSyncMirror();
    await expect(new SyncMirrorVfs().openReadable('/missing.bin')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
