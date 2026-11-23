import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompressSync, gunzipSync, gzipSync } from 'node:zlib';
import { build } from 'esbuild';
const require = createRequire(
  new URL('../../../../packages/workbench/package.json', import.meta.url),
);
const { compress } = require('brotli-compress');
const temp = await mkdtemp(join(tmpdir(), 'rifty-brotli-cost-'));
try {
  await build({
    entryPoints: ['packages/workbench/src/glue/dep-snapshot.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: join(temp, 'loader.mjs'),
  });
  const { parseDepSnapshot, serializeDepSnapshotTar } = await import(join(temp, 'loader.mjs'));
  const tar = new Uint8Array(
    serializeDepSnapshotTar(
      parseDepSnapshot(
        gunzipSync(
          await readFile('apps/playground/public/snapshots/vite-node-modules.json.gz'),
        ).toString(),
      ),
    ),
  );
  const started = performance.now();
  const br = await compress(tar, { quality: 11 });
  const encodeMs = Math.round(performance.now() - started);
  assert.deepEqual(brotliDecompressSync(br), Buffer.from(tar));
  console.log(
    JSON.stringify({
      node: process.version,
      tarBytes: tar.length,
      gzipBytes: gzipSync(tar).length,
      brotliBytes: br.length,
      encodeMs,
      moduleBytes: (await readFile(require.resolve('brotli-compress/index.mjs'))).length,
    }),
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
