import { describe, expect, it } from 'vitest';
import { extractTarGz } from './unpacker.ts';

const enc = new TextEncoder();

/**
 * Write `bytes` of `s` (zero-padded) into `buf` at `off`, capped at `len`.
 */
function writeStr(buf: Uint8Array, str: string, off: number, len: number): void {
  const b = enc.encode(str);
  buf.set(b.subarray(0, Math.min(b.length, len)), off);
}

/**
 * Build a single 512-byte tar header. `typeFlag` is a single ASCII char
 * (e.g. '0' for regular file, '2' for symlink, 'L' for GNU long-name).
 * Returns the header alone — caller appends the data blocks.
 */
function buildHeader(
  name: string,
  size: number,
  typeFlag: string,
  opts: { linkname?: string; ustar?: boolean } = {},
): Uint8Array {
  const h = new Uint8Array(512);
  writeStr(h, name, 0, 100);
  writeStr(h, '0000644', 100, 7);
  writeStr(h, '0000000', 108, 7);
  writeStr(h, '0000000', 116, 7);
  writeStr(h, size.toString(8).padStart(11, '0'), 124, 11);
  h[135] = 0x20;
  writeStr(h, '00000000000', 136, 11);
  h[147] = 0x20;
  for (let i = 148; i < 156; i++) h[i] = 0x20;
  h[156] = typeFlag.charCodeAt(0);
  if (opts.linkname) writeStr(h, opts.linkname, 157, 100);
  if (opts.ustar !== false) {
    writeStr(h, 'ustar', 257, 6);
    writeStr(h, '00', 263, 2);
  }
  // Pseudo-checksum (parser doesn't actually verify it for our minimal impl).
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += h[i] ?? 0;
  writeStr(h, sum.toString(8).padStart(6, '0'), 148, 6);
  h[154] = 0x00;
  h[155] = 0x20;
  return h;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function padToBlock(data: Uint8Array): Uint8Array {
  const blocks = Math.ceil(data.length / 512);
  const padded = new Uint8Array(blocks * 512);
  padded.set(data);
  return padded;
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as unknown as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  const ab = await new Response(stream).arrayBuffer();
  return new Uint8Array(ab);
}

const trailer = new Uint8Array(1024); // two zero blocks

describe('extractTarGz — typeflag handling', () => {
  it("throws NotImplementedError('npm-client.tar.symlink') for symlink entries (typeflag '2')", async () => {
    const data = enc.encode(''); // symlinks carry the target in linkname, not body
    const header = buildHeader('package/link', 0, '2', { linkname: 'real.js' });
    const tar = concat(header, padToBlock(data), trailer);
    const tgz = await gzip(tar);

    let caught: unknown;
    try {
      await extractTarGz(tgz);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const err = caught as Error & { feature?: string };
    expect(err.message).toContain('npm-client.tar.symlink');
    // NotImplementedError from @rifty/io exposes `.feature`
    expect(err.feature).toBe('npm-client.tar.symlink');
  });

  it("decodes GNU long-name 'L' entries — the next header's name is the previous entry's data", async () => {
    const longName = `package/${'x'.repeat(120)}/deep/inside/file.js`;
    const longNameBytes = concat(enc.encode(longName), new Uint8Array([0])); // NUL-terminated

    const longHeader = buildHeader('././@LongLink', longNameBytes.length, 'L');
    const fileContent = enc.encode('console.log(1);');
    // The "real" header carries a short truncated name (which our parser must ignore).
    const fileHeader = buildHeader('truncated-short-name', fileContent.length, '0');

    const tar = concat(
      longHeader,
      padToBlock(longNameBytes),
      fileHeader,
      padToBlock(fileContent),
      trailer,
    );
    const tgz = await gzip(tar);
    const out = await extractTarGz(tgz);

    const expectedKey = longName.slice('package/'.length);
    expect(Object.keys(out)).toEqual([expectedKey]);
    expect(out[expectedKey]).toEqual(fileContent);
  });

  it("decodes GNU long-linkname 'K' entries — content overrides linkname of the next entry", async () => {
    // 'K' applies to linkname, not name; subsequent entry is again a file. We
    // just need to confirm the parser doesn't choke and that it doesn't emit
    // the long-link metadata as a file.
    const longLinkBytes = concat(enc.encode('target/path/'.repeat(20)), new Uint8Array([0]));
    const linkHeader = buildHeader('././@LongLink', longLinkBytes.length, 'K');
    const fileContent = enc.encode('content');
    const fileHeader = buildHeader('package/normal.txt', fileContent.length, '0');

    const tar = concat(
      linkHeader,
      padToBlock(longLinkBytes),
      fileHeader,
      padToBlock(fileContent),
      trailer,
    );
    const tgz = await gzip(tar);
    const out = await extractTarGz(tgz);

    // The 'K' record should not appear as a file. Only the normal file remains.
    expect(Object.keys(out)).toEqual(['normal.txt']);
  });

  it('still extracts a plain file tar (regression — does not break the happy path)', async () => {
    const content = enc.encode('ok');
    const header = buildHeader('package/a.txt', content.length, '0');
    const tar = concat(header, padToBlock(content), trailer);
    const tgz = await gzip(tar);

    const out = await extractTarGz(tgz);
    expect(out['a.txt']).toEqual(content);
  });
});
