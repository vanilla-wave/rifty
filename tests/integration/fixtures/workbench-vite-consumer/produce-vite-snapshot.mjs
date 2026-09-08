import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
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
    'install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund',
    '--registry', registryUrl, '--cache', resolve('producer-vite-npm-cache'),
  ],
  { cwd: inputRoot, stdio: 'pipe' },
);
const packageLockText = await readFile(resolve(inputRoot, 'package-lock.json'), 'utf8');
const templateId = 'packed-snapshot-vite';
const snapshot = await produceDependencySnapshot({
  packageJsonText, packageLockText, registryUrl, templateId,
});
const archivePath = resolve('dist/producer-vite-snapshot.tar.gz');
await writeFile(archivePath, snapshot.archive);
const emittedManifest = execFileSync('tar', ['-xzOf', archivePath, 'payload/package.json'], {
  encoding: 'utf8',
});
const installed = JSON.parse(execFileSync('tar', [
  '-xzOf', archivePath, 'payload/node_modules/vite/package.json',
], { encoding: 'utf8' }));
assert.equal(installed.version, '7.3.6');
await writeFile(resolve('dist/producer-vite-snapshot.json'), JSON.stringify({
  packageJsonText: emittedManifest,
  snapshotId: snapshot.snapshotId,
  installArtifactIdentity: snapshot.installArtifactIdentity,
  templateId,
}));
console.log('Packed Vite producer: caller npm lock, Vite 7.3.6 tar.gz and identities');
