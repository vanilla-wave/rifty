import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { createMemoryFs } from '../../../packages/vfs/src/internal/index.ts';
import { decodeDepSnapshotTar } from '../../../packages/workbench/src/glue/dep-snapshot-tar.ts';
import {
  buildDepSnapshot,
  parseDepSnapshot,
  prepareDepSnapshotRestore,
  serializeDepSnapshotTar,
} from '../../../packages/workbench/src/glue/dep-snapshot.ts';
import { bakeApplicationPackage } from './snapshot-application-package.ts';

const fixtureRoot = dirname(fileURLToPath(import.meta.url));
async function main(directory: string) {
  const app = await bakeApplicationPackage();
  const initial = parseDepSnapshot(
    JSON.stringify(decodeDepSnapshotTar(new Uint8Array(gunzipSync(new Uint8Array(app.archive))))),
  );
  const manifest = JSON.parse(
    await readFile(join(fixtureRoot, 'tracker-tree-manifest.json'), 'utf8'),
  ) as { files: [string, number][] };
  const { fsSync: fs } = createMemoryFs();
  const encoder = new TextEncoder();
  fs.mkdirSync('/workspace', { recursive: true });
  fs.writeFileSync('/workspace/package.json', encoder.encode(initial.packageJsonText));
  (await prepareDepSnapshotRestore(fs, '/workspace', initial)).apply();
  for (const [index, [relative, size]] of manifest.files.entries()) {
    const path = `/workspace/node_modules/.tracker-scale/${relative}`;
    fs.mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
    const bytes = new Uint8Array(size).fill(73);
    for (let n = 0; n < Math.min(4, size); n++) bytes[n] = (index >>> (n * 8)) & 255;
    fs.writeFileSync(path, bytes);
  }
  fs.writeFileSync(
    '/workspace/node_modules/.tracker-scale-manifest.json',
    encoder.encode(JSON.stringify(manifest)),
  );
  const snapshot = buildDepSnapshot(fs, '/workspace', {
    templateId: 'replica-public-scale',
    deps: { ...initial.deps },
    packages: initial.packages,
  });
  const tar = serializeDepSnapshotTar(snapshot);
  await writeFile(join(directory, 'snapshot.tar.gz'), gzipSync(tar));
  await writeFile(
    join(directory, 'meta.json'),
    JSON.stringify({
      snapshotId: `sha256:${createHash('sha256').update(tar).digest('hex')}`,
      templateId: snapshot.templateId,
      packageJsonText: snapshot.packageJsonText,
    }),
  );
  await writeFile(join(directory, 'ms-metadata.json'), JSON.stringify(app.packageManifest));
}
const directory = process.argv[2];
if (!directory) throw new Error('Output directory required');
await main(directory);
