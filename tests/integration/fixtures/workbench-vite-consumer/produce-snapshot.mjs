import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import * as workbench from '@riftydev/workbench';

assert.equal(typeof workbench.produceDependencySnapshot, 'function', 'packed public producer');
const registryUrl = process.argv[2];
if (!registryUrl) throw new Error('Pass the fixture registry URL');
const inputRoot = resolve('producer-input');
await mkdir(inputRoot, { recursive: true });
const packageJsonText = JSON.stringify({
  name: 'packed-snapshot-ms',
  version: '1.0.0',
  dependencies: { ms: '2.0.0' },
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
    resolve('producer-npm-cache'),
  ],
  { cwd: inputRoot, stdio: 'pipe' },
);
const packageLockText = await readFile(resolve(inputRoot, 'package-lock.json'), 'utf8');
const options = { packageJsonText, packageLockText, registryUrl, templateId: 'packed-ms' };
const first = await workbench.produceDependencySnapshot(options);
const second = await workbench.produceDependencySnapshot(options);
assert.deepEqual(first.archive, second.archive, 'same caller input yields stable archive');
const tar = gunzipSync(first.archive);
assert.equal(first.snapshotId, `sha256:${createHash('sha256').update(tar).digest('hex')}`);
await writeFile(resolve('dist/producer-snapshot.tar.gz'), first.archive);
await writeFile(resolve('dist/producer-snapshot.tar'), tar);
const emittedManifest = execFileSync(
  'tar',
  ['-xzOf', resolve('dist/producer-snapshot.tar.gz'), 'payload/package.json'],
  { encoding: 'utf8' },
);
const installed = JSON.parse(
  execFileSync(
    'tar',
    ['-xzOf', resolve('dist/producer-snapshot.tar.gz'), 'payload/node_modules/ms/package.json'],
    { encoding: 'utf8' },
  ),
);
assert.equal(installed.version, '2.0.0');
const extracted = resolve('producer-extracted');
await mkdir(extracted, { recursive: true });
execFileSync('tar', ['-xzf', resolve('dist/producer-snapshot.tar.gz'), '-C', extracted]);
const entrySource = "console.log('packed-snapshot-' + require('ms')('2s'))\n";
await writeFile(resolve(extracted, 'payload/main.cjs'), entrySource);
const expectedOutput = execFileSync(process.execPath, ['main.cjs'], {
  cwd: resolve(extracted, 'payload'),
  encoding: 'utf8',
}).trim();
assert.equal(expectedOutput, 'packed-snapshot-2000');
await writeFile(
  resolve('dist/producer-snapshot.json'),
  JSON.stringify({
    packageJsonText: emittedManifest,
    entrySource,
    expectedOutput,
    snapshotId: first.snapshotId,
    installArtifactIdentity: first.installArtifactIdentity,
    templateId: options.templateId,
  }),
);
console.log('Packed producer: real npm lock, ms@2.0.0, deterministic tar.gz and identities');
