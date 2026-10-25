import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';
import { readJson, tarballIntegrity } from './installed-registry.mjs';
const gunzipAsync = promisify(gunzip);

// Genuine pinned Vite/registry archives shared by the packed consumer and benchmark smoke.
function lockfilePackageName(path) {
  const prefix = 'node_modules/';
  if (!path.startsWith(prefix)) throw new Error(`Unsupported snapshot lock path: ${path}`);
  const segments = path.slice(prefix.length).split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error(`Packed consumer snapshot requires a flat package tree: ${path}`);
  }
  if (segments[0]?.startsWith('@') && segments.length === 2) {
    return `${segments[0]}/${segments[1]}`;
  }
  if (segments.length === 1) return segments[0];
  throw new Error(`Packed consumer snapshot requires a flat package tree: ${path}`);
}

export async function browserRegistryPackages(repoRoot) {
  const viteSnapshot = resolve(
    repoRoot,
    'apps/playground/public/snapshots/vite-node-modules.json.gz',
  );
  const snapshot = JSON.parse(String(await gunzipAsync(await readFile(viteSnapshot))));
  if (snapshot.version !== 3 || snapshot.templateId !== 'vite')
    throw new Error('Packed consumer requires the committed Vite snapshot v3');
  const required = new Map();
  for (const [path, entry] of Object.entries(JSON.parse(snapshot.lockfile).packages)) {
    if (path.length === 0) continue;
    const name = lockfilePackageName(path);
    if (required.has(name)) throw new Error(`Duplicate snapshot package ${name}`);
    required.set(name, entry.version);
  }
  assert.equal(required.get('esbuild-wasm'), '0.28.0', 'existing registry recipe asset');
  const fixture = resolve(repoRoot, 'tests/integration/fixtures/registry/rollup-companions');
  const provenance = await readJson(resolve(fixture, 'provenance.json'));
  const packages = new Map();
  for (const [name, version] of required) {
    const source = provenance.packages.find(
      (item) => item.name === name && item.version === version,
    );
    if (!source) throw new Error(`Missing original npm fixture ${name}@${version}`);
    const manifest = await readJson(resolve(fixture, 'packages', `${source.file}.json`));
    assert.equal(manifest.name, name);
    assert.equal(manifest.version, version);
    assert.equal(manifest.dist.integrity, source.integrity);
    assert.equal(manifest.dist.tarball, source.tarball);
    const tarball = resolve(fixture, 'packages', `${source.file}.tgz`);
    const bytes = await readFile(tarball);
    assert.equal(bytes.length, source.bytes, `original ${name} byte length`);
    assert.equal(tarballIntegrity(bytes), source.integrity, `original ${name} npm integrity`);
    packages.set(name, {
      name,
      manifest,
      tarball,
      integrity: source.integrity,
      shasum: createHash('sha1').update(bytes).digest('hex'),
    });
  }
  const msTarball = resolve(repoRoot, 'tests/integration/fixtures/registry/ms-2.0.0.tgz');
  const msBytes = await readFile(msTarball);
  packages.set('ms', {
    name: 'ms',
    tarball: msTarball,
    manifest: JSON.parse(
      execFileSync('tar', ['-xzOf', msTarball, 'package/package.json'], { encoding: 'utf8' }),
    ),
    integrity: tarballIntegrity(msBytes),
    shasum: createHash('sha1').update(msBytes).digest('hex'),
  });
  return packages;
}
