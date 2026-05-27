import { describe, expect, it } from 'vitest';
import {
  buildHeader,
  concat,
  gzip,
  padToBlock,
  TAR_TRAILER as trailer,
} from './_test-fixtures/tar-builder.ts';
import { extractTarGz } from './unpacker.ts';

const enc = new TextEncoder();

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
