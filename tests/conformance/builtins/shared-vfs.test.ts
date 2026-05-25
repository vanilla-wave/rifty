/**
 * ADR-0014 conformance — `MemoryVfs` (async) and `MemoryFsSync` (sync) bind
 * to a shared `MemoryBackend` when paired via `createMemoryFs()`. Writes via
 * either surface are visible through the other; reads agree byte-for-byte.
 *
 * Combined with ADR-0020 phase 2: `fs.createReadStream` now pulls chunks
 * via `Vfs.openReadable` when an async VFS is installed, so a 256 KiB read
 * with a 64 KiB highWaterMark emits ≥ 4 data events rather than one giant
 * buffer.
 */
import { asyncVfs, syncMirror } from '@rifty/vfs';
import { createMemoryFs, installMemoryFs, resetSyncMirror } from '@rifty/vfs/internal';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createReadStream } from '../../../packages/runtime-js/src/builtins/fs-streams.ts';

describe('createMemoryFs — shared backing tree (ADR-0014)', () => {
  it('writes via Vfs.writeFile are visible through FsSync.readFileBytesSync', async () => {
    const { vfs, fsSync } = createMemoryFs();
    await vfs.writeFile('/a.txt', 'hello');
    expect(new TextDecoder().decode(fsSync.readFileBytesSync('/a.txt'))).toBe('hello');
  });

  it('writes via FsSync.writeFileSync are visible through Vfs.readFile', async () => {
    const { vfs, fsSync } = createMemoryFs();
    fsSync.writeFileSync('/b.txt', new TextEncoder().encode('world'));
    expect(await vfs.readFileText('/b.txt')).toBe('world');
  });

  it('directory ops mirror across both surfaces', async () => {
    const { vfs, fsSync } = createMemoryFs();
    await vfs.mkdir('/dir', { recursive: true });
    await vfs.writeFile('/dir/file.txt', 'x');
    expect(fsSync.readdirSync('/dir')).toEqual(['file.txt']);
    expect(fsSync.statSync('/dir').isDirectory).toBe(true);
  });

  it('installMemoryFs wires syncMirror() and asyncVfs() to the same backend', async () => {
    installMemoryFs();
    syncMirror().mkdirSync('/work', { recursive: true });
    syncMirror().writeFileSync('/work/a.json', new TextEncoder().encode('{}'));
    const v = asyncVfs();
    expect(v).not.toBeNull();
    expect(await v!.readFileText('/work/a.json')).toBe('{}');
  });
});

describe('createReadStream — true streaming via openReadable (ADR-0020 phase 2)', () => {
  beforeEach(() => {
    installMemoryFs();
  });

  afterEach(() => {
    resetSyncMirror();
  });

  it('emits ≥ 4 chunks for a 256 KiB file at 64 KiB highWaterMark', async () => {
    const payload = new Uint8Array(256 * 1024);
    for (let i = 0; i < payload.length; i++) payload[i] = i & 0xff;
    syncMirror().writeFileSync('/big.bin', payload);

    const chunks: Uint8Array[] = [];
    const stream = createReadStream('/big.bin', { highWaterMark: 64 * 1024 });
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (chunk: unknown) => chunks.push(chunk as Uint8Array));
      stream.on('end', resolve);
      stream.on('error', reject);
    });

    expect(chunks.length).toBeGreaterThanOrEqual(4);
    const total = chunks.reduce((n, c) => n + c.byteLength, 0);
    expect(total).toBe(payload.length);
  });

  it('honours start/end byte offsets', async () => {
    const payload = new TextEncoder().encode('abcdefghij');
    syncMirror().writeFileSync('/r.txt', payload);
    const chunks: Uint8Array[] = [];
    const stream = createReadStream('/r.txt', { start: 2, end: 7 });
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (chunk: unknown) => chunks.push(chunk as Uint8Array));
      stream.on('end', resolve);
      stream.on('error', reject);
    });
    const joined = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
    let off = 0;
    for (const c of chunks) {
      joined.set(c, off);
      off += c.byteLength;
    }
    expect(new TextDecoder().decode(joined)).toBe('cdefg');
  });
});
