import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { produceDependencySnapshot } from '@riftydev/workbench';

const registryUrl = process.argv[2];
if (!registryUrl) throw new Error('Pass the fixture registry URL');
const inputRoot = resolve('producer-vite-input');
await mkdir(inputRoot, { recursive: true });
const packageJsonText = JSON.stringify({
  name: 'packed-snapshot-vite',
  version: '1.0.0',
  private: true,
  type: 'module',
  scripts: { dev: 'vite --port 5173', build: 'vite build', probe: 'node probe.cjs' },
  dependencies: { vite: '7.3.6' },
});
await writeFile(resolve(inputRoot, 'package.json'), packageJsonText);
execFileSync(
  'npm',
  [
    'install',
    '--package-lock-only',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--registry',
    registryUrl,
    '--cache',
    resolve('producer-vite-npm-cache'),
  ],
  { cwd: inputRoot, stdio: 'pipe' },
);
const packageLockText = await readFile(resolve(inputRoot, 'package-lock.json'), 'utf8');
const templateId = 'packed-snapshot-vite';
const snapshot = await produceDependencySnapshot({
  packageJsonText,
  packageLockText,
  registryUrl,
  templateId,
});
const started = performance.now();
const brotli = await produceDependencySnapshot({
  packageJsonText,
  packageLockText,
  registryUrl,
  templateId,
  encoding: 'br',
});
assert.equal(brotli.contentEncoding, 'br');
assert.deepEqual(brotliDecompressSync(brotli.archive), gunzipSync(snapshot.archive));
assert.equal(brotli.snapshotId, snapshot.snapshotId);
assert.equal(brotli.installArtifactIdentity, snapshot.installArtifactIdentity);
await writeFile(resolve('dist/producer-vite-snapshot.tar.br'), brotli.archive);
console.log(
  JSON.stringify({
    gzipBytes: snapshot.archive.length,
    brotliBytes: brotli.archive.length,
    brotliProductionMs: Math.round(performance.now() - started),
  }),
);
const archivePath = resolve('dist/producer-vite-snapshot.tar.gz');
await writeFile(archivePath, snapshot.archive);
const emittedManifest = execFileSync('tar', ['-xzOf', archivePath, 'payload/package.json'], {
  encoding: 'utf8',
});
const installed = JSON.parse(
  execFileSync('tar', ['-xzOf', archivePath, 'payload/node_modules/vite/package.json'], {
    encoding: 'utf8',
  }),
);
assert.equal(installed.version, '7.3.6');
await writeFile(
  resolve('dist/producer-vite-snapshot.json'),
  JSON.stringify({
    packageJsonText: emittedManifest,
    snapshotId: snapshot.snapshotId,
    installArtifactIdentity: snapshot.installArtifactIdentity,
    templateId,
  }),
);
console.log('Packed Vite producer: caller npm lock, Vite 7.3.6 tar.gz and identities');

// Same caller inputs and installed payload; only replay transport changes.
const frozen = await produceDependencySnapshot({
  packageJsonText,
  packageLockText,
  registryUrl,
  templateId,
  profile: 'frozen',
});
const frozenPath = resolve('dist/producer-vite-frozen.tar.gz');
await writeFile(frozenPath, frozen.archive);
const frozenControl = JSON.parse(
  execFileSync('tar', ['-xzOf', frozenPath, 'rifty/manifest.json'], { encoding: 'utf8' }),
);
assert.equal(frozenControl.version, 5, 'frozen requires an incompatible-reader version');
assert.equal(frozenControl.profile, 'frozen');
const entries = (path) =>
  execFileSync('tar', ['-tzf', path], { encoding: 'utf8' }).trim().split('\n');
assert(
  !entries(frozenPath).some((path) => path.startsWith('rifty/replay-cache')),
  'frozen carries no replay archive namespace',
);
const payloadEntries = entries(archivePath).filter((path) => path.startsWith('payload/'));
assert.deepEqual(
  entries(frozenPath).filter((path) => path.startsWith('payload/')),
  payloadEntries,
);
const compareRoot = resolve('producer-payload-comparison');
for (const [name, archive] of [
  ['replay', archivePath],
  ['frozen', frozenPath],
]) {
  await mkdir(resolve(compareRoot, name), { recursive: true });
  execFileSync('tar', ['-xzf', archive, '-C', resolve(compareRoot, name)]);
}
for (const path of payloadEntries.filter((path) => !path.endsWith('/'))) {
  assert.deepEqual(
    await readFile(resolve(compareRoot, 'frozen', path)),
    await readFile(resolve(compareRoot, 'replay', path)),
    path,
  );
}
assert(frozen.archive.length < snapshot.archive.length, 'same-input frozen gzip must be smaller');
await writeFile(
  resolve('dist/producer-vite-frozen.json'),
  JSON.stringify({
    snapshotId: frozen.snapshotId,
    templateId,
  }),
);
console.log(
  `Frozen Vite pair: replay ${snapshot.archive.length} B, frozen ${frozen.archive.length} B`,
);

const originalManifest = JSON.parse(packageJsonText);
const updatedManifest = JSON.stringify({
  ...originalManifest,
  version: '1.0.1',
  dependencies: { ...originalManifest.dependencies, ms: '2.0.0' },
});
await writeFile(resolve(inputRoot, 'package.json'), updatedManifest);
execFileSync(
  'npm',
  [
    'install',
    '--package-lock-only',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--registry',
    registryUrl,
    '--cache',
    resolve('producer-vite-npm-cache'),
  ],
  { cwd: inputRoot, stdio: 'pipe' },
);
const updatedLock = await readFile(resolve(inputRoot, 'package-lock.json'), 'utf8');
const updated = await produceDependencySnapshot({
  packageJsonText: updatedManifest,
  packageLockText: updatedLock,
  registryUrl,
  templateId,
});
await writeFile(resolve('dist/producer-vite-update.tar.gz'), updated.archive);
await writeFile(
  resolve('dist/producer-vite-update.json'),
  JSON.stringify({
    snapshotId: updated.snapshotId,
    installArtifactIdentity: updated.installArtifactIdentity,
    templateId,
  }),
);
