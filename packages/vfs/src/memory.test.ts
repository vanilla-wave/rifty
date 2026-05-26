import { describe, expect, it } from 'vitest';
import { VfsError } from './errors.ts';
import { MemoryVfs } from './memory.ts';
import { MemoryFsSync, createMemoryFs } from './sync-mirror.ts';

describe('MemoryVfs', () => {
  it('writes and reads files', async () => {
    const fs = new MemoryVfs();
    await fs.writeFile('/hello.txt', 'world');
    expect(await fs.readFileText('/hello.txt')).toBe('world');
  });

  it('readFile returns Uint8Array', async () => {
    const fs = new MemoryVfs();
    await fs.writeFile('/bin', new Uint8Array([1, 2, 3]));
    const data = await fs.readFile('/bin');
    expect(data).toBeInstanceOf(Uint8Array);
    expect(Array.from(data)).toEqual([1, 2, 3]);
  });

  it('mkdir recursive creates parents', async () => {
    const fs = new MemoryVfs();
    await fs.mkdir('/a/b/c', { recursive: true });
    expect((await fs.stat('/a/b/c')).isDirectory).toBe(true);
    expect((await fs.stat('/a/b')).isDirectory).toBe(true);
    expect((await fs.stat('/a')).isDirectory).toBe(true);
  });

  it('mkdir non-recursive throws if parent missing', async () => {
    const fs = new MemoryVfs();
    await expect(fs.mkdir('/missing/leaf')).rejects.toThrow(VfsError);
  });

  it('writeFile into missing dir throws ENOENT', async () => {
    const fs = new MemoryVfs();
    await expect(fs.writeFile('/no/such/file', 'x')).rejects.toThrow(/ENOENT/);
  });

  it('readdir lists children sorted', async () => {
    const fs = new MemoryVfs();
    await fs.mkdir('/root', { recursive: true });
    await fs.writeFile('/root/b.txt', 'b');
    await fs.writeFile('/root/a.txt', 'a');
    await fs.mkdir('/root/sub', { recursive: true });
    const entries = await fs.readdir('/root');
    expect(entries.map((e) => e.name)).toEqual(['a.txt', 'b.txt', 'sub']);
    expect(entries.find((e) => e.name === 'sub')?.isDirectory).toBe(true);
  });

  it('stat returns sizes for files and 0 for dirs', async () => {
    const fs = new MemoryVfs();
    await fs.writeFile('/x', 'hello');
    expect((await fs.stat('/x')).size).toBe(5);
    expect((await fs.stat('/')).isDirectory).toBe(true);
  });

  it('rm recursive removes a directory tree', async () => {
    const fs = new MemoryVfs();
    await fs.mkdir('/a/b/c', { recursive: true });
    await fs.writeFile('/a/b/c/x.txt', 'x');
    await fs.rm('/a', { recursive: true });
    expect(await fs.exists('/a')).toBe(false);
  });

  it('rm non-recursive on non-empty dir throws ENOTEMPTY (Node parity)', async () => {
    const fs = new MemoryVfs();
    await fs.mkdir('/a', { recursive: true });
    await fs.writeFile('/a/x', 'x');
    await expect(fs.rm('/a')).rejects.toMatchObject({
      name: 'VfsError',
      code: 'ENOTEMPTY',
    });
  });

  it('rm force ignores missing', async () => {
    const fs = new MemoryVfs();
    await expect(fs.rm('/nope', { force: true })).resolves.toBeUndefined();
  });

  it('normalises relative paths at entry — write to ./foo/../bar.txt reads as /bar.txt', async () => {
    const fs = new MemoryVfs();
    await fs.writeFile('./foo/../bar.txt', 'normalised');
    expect(await fs.readFileText('/bar.txt')).toBe('normalised');
    expect(await fs.exists('/bar.txt')).toBe(true);
    expect(await fs.exists('bar.txt')).toBe(true);
    expect(await fs.exists('/foo/../bar.txt')).toBe(true);
  });

  describe('openReadable', () => {
    async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array[]> {
      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
      return chunks;
    }

    function concat(chunks: Uint8Array[]): Uint8Array {
      const total = chunks.reduce((acc, c) => acc + c.byteLength, 0);
      const out = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        out.set(c, off);
        off += c.byteLength;
      }
      return out;
    }

    it('reads a small file in a single chunk under default chunkSize', async () => {
      const fs = new MemoryVfs();
      const bytes = new Uint8Array(200);
      for (let i = 0; i < bytes.length; i++) bytes[i] = i & 0xff;
      await fs.writeFile('/a.txt', bytes);
      const stream = await fs.openReadable('/a.txt');
      const chunks = await collect(stream);
      expect(chunks.length).toBe(1);
      expect(chunks[0]?.byteLength).toBe(200);
      expect(Array.from(concat(chunks))).toEqual(Array.from(bytes));
    });

    it('splits a file across multiple chunks when chunkSize is smaller', async () => {
      const fs = new MemoryVfs();
      const bytes = new Uint8Array(64);
      for (let i = 0; i < bytes.length; i++) bytes[i] = i;
      await fs.writeFile('/big.bin', bytes);
      const stream = await fs.openReadable('/big.bin', { chunkSize: 16 });
      const chunks = await collect(stream);
      expect(chunks.length).toBe(4);
      for (const c of chunks) expect(c.byteLength).toBe(16);
      expect(Array.from(concat(chunks))).toEqual(Array.from(bytes));
    });

    it('honors start and end byte offsets', async () => {
      const fs = new MemoryVfs();
      const bytes = new Uint8Array(20);
      for (let i = 0; i < bytes.length; i++) bytes[i] = i;
      await fs.writeFile('/sub.txt', bytes);
      const stream = await fs.openReadable('/sub.txt', { start: 5, end: 10 });
      const chunks = await collect(stream);
      const out = concat(chunks);
      expect(out.byteLength).toBe(5);
      expect(Array.from(out)).toEqual([5, 6, 7, 8, 9]);
    });

    it('rejects with ENOENT for missing file', async () => {
      const fs = new MemoryVfs();
      await expect(fs.openReadable('/missing')).rejects.toMatchObject({
        name: 'VfsError',
        code: 'ENOENT',
      });
    });

    it('rejects with EISDIR for a directory', async () => {
      const fs = new MemoryVfs();
      await fs.mkdir('/dir', { recursive: true });
      await expect(fs.openReadable('/dir')).rejects.toMatchObject({
        name: 'VfsError',
        code: 'EISDIR',
      });
    });
  });
});

describe('MemoryFsSync.utimes (ADR-0029)', () => {
  it('updates stat.mtime to the supplied mtime in ms', () => {
    const { fsSync } = createMemoryFs();
    fsSync.writeFileSync('/a', new Uint8Array([1]));
    fsSync.utimes('/a', 1000, 2000);
    expect(fsSync.statSync('/a').mtime).toBe(2000);
  });

  it('updates mtime independently of atime', () => {
    const { fsSync } = createMemoryFs();
    fsSync.writeFileSync('/a', new Uint8Array([1]));
    fsSync.utimes('/a', 5000, 9999);
    expect(fsSync.statSync('/a').mtime).toBe(9999);
  });

  it('throws VfsError ENOENT for non-existent paths', () => {
    const fsSync = new MemoryFsSync();
    expect(() => fsSync.utimes('/missing', 1, 2)).toThrow(VfsError);
    try {
      fsSync.utimes('/missing', 1, 2);
    } catch (err) {
      expect((err as VfsError).code).toBe('ENOENT');
    }
  });

  it('works on directories too', () => {
    const fsSync = new MemoryFsSync();
    fsSync.mkdirSync('/d', { recursive: true });
    fsSync.utimes('/d', 100, 200);
    expect(fsSync.statSync('/d').mtime).toBe(200);
  });
});
