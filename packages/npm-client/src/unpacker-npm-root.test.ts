import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import {
  TAR_TRAILER,
  buildHeader,
  concat,
  gzip,
  padToBlock,
} from './_test-fixtures/tar-builder.ts';
import { extractTarGz } from './unpacker.ts';

it('places the original @types/react archive at the same paths and bytes as npm11.17', async () => {
  const root = new URL('./_test-fixtures/types-react-19.3.0/', import.meta.url);
  const tarball = new Uint8Array(await readFile(new URL('package.tgz', root)));
  const oracle = JSON.parse(await readFile(new URL('native-oracle.json', root), 'utf8')) as {
    entries: Record<string, { size: number; sha256: string }>;
  };
  const files = await extractTarGz(tarball);
  expect(
    Object.fromEntries(
      Object.entries(files).map(([path, bytes]) => [
        path,
        { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') },
      ]),
    ),
  ).toEqual(oracle.entries);
  expect(JSON.parse(new TextDecoder().decode(files['package.json']))).toMatchObject({
    name: '@types/react',
    version: '19.3.0',
  });
});

it('matches npm strip-one path mapping for other roots, dot-prefix and ordinary property names', async () => {
  const cases = JSON.parse(
    await readFile(
      new URL('./_test-fixtures/types-react-19.3.0/path-variants.json', import.meta.url),
      'utf8',
    ),
  ) as { names: string[]; typeFlag?: string; entries: Record<string, string> }[];
  for (const { names, entries, typeFlag } of cases) {
    const body = new TextEncoder().encode('{"name":"native-root-probe","version":"1.0.0"}');
    const bytes = await gzip(
      concat(
        ...names.flatMap((name) => [
          buildHeader(name, body.length, typeFlag ?? '0'),
          padToBlock(body),
        ]),
        TAR_TRAILER,
      ),
    );
    const files = await extractTarGz(bytes);
    expect(
      Object.fromEntries(
        Object.entries(files).map(([path, bytes]) => [path, new TextDecoder().decode(bytes)]),
      ),
      JSON.stringify(names),
    ).toEqual(entries);
  }
});
