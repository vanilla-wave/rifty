// Registry fault fixture: upstream archive with injected dependency metadata.
// Stock upstream acceptance remains installer-esbuild-upstream.test.ts.
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { MemoryVfs } from '@riftydev/vfs';
import { describe, expect, it } from 'vitest';
import {
  TAR_TRAILER,
  buildHeader,
  concat,
  gzip,
  padToBlock,
} from './_test-fixtures/tar-builder.ts';
import { install } from './installer.ts';
import { RegistryClient } from './registry.ts';
import { extractTarGz } from './unpacker.ts';
const enc = new TextEncoder();
async function pack(files: Record<string, Uint8Array>) {
  return gzip(
    concat(
      ...Object.entries(files).flatMap(([name, bytes]) => [
        buildHeader(`package/${name}`, bytes.length),
        padToBlock(bytes),
      ]),
      TAR_TRAILER,
    ),
  );
}
async function setup(bundled = false) {
  const archive = readFileSync(
    new URL(
      '../../../tests/integration/fixtures/registry/esbuild-upstream/esbuild-wasm-0.28.2.tgz',
      import.meta.url,
    ),
  );
  const files = await extractTarGz(archive);
  const upstream = JSON.parse(new TextDecoder().decode(files['package.json']));
  const dependencies = { ordinary: '1.0.0' };
  const optionalDependencies = { optional: '1.0.0' };
  const peerDependencies = { peer: '1.0.0' };
  const manifest = {
    ...upstream,
    dependencies,
    optionalDependencies,
    peerDependencies,
    ...(bundled ? { bundleDependencies: ['ordinary', 'optional'] } : {}),
  };
  const tarballs: Record<string, Uint8Array> = {};
  const manifests: Record<string, Record<string, unknown>> = {};
  for (const name of ['ordinary', 'optional', 'peer']) {
    const child = { name, version: '1.0.0', main: 'index.js' };
    const small = {
      'package.json': enc.encode(JSON.stringify(child)),
      'index.js': enc.encode(`module.exports = ${JSON.stringify(name)};`),
    };
    tarballs[name] = await pack(small);
    manifests[name] = child;
    if (bundled && name !== 'peer')
      for (const [path, bytes] of Object.entries(small))
        files[`node_modules/${name}/${path}`] = bytes;
  }
  files['package.json'] = enc.encode(JSON.stringify(manifest));
  tarballs['esbuild-wasm'] = await pack(files);
  manifests['esbuild-wasm'] = manifest;
  if (bundled) {
    writeFileSync('/tmp/esbuild-review-bundled.tgz', tarballs['esbuild-wasm']);
    writeFileSync('/tmp/esbuild-review-peer.tgz', tarballs.peer);
  }
  const calls: string[] = [];
  const registry = new RegistryClient({
    baseUrl: 'https://review.test',
    fetch: async (input) => {
      const name = new URL(input).pathname.slice(1);
      calls.push(name);
      if (name.endsWith('.tgz')) return new Response(new Uint8Array(tarballs[name.slice(0, -4)]));
      const m = manifests[name];
      if (!m) throw Error(`Unexpected ${name}`);
      return Response.json({
        name,
        'dist-tags': { latest: m.version },
        versions: {
          [String(m.version)]: {
            ...m,
            dist: {
              tarball: `https://review.test/${name}.tgz`,
              integrity: `sha512-${createHash('sha512').update(tarballs[name]).digest('base64')}`,
            },
          },
        },
      });
    },
  });
  const vfs = new MemoryVfs();
  await vfs.mkdir('/p', { recursive: true });
  await vfs.writeFile(
    '/p/package.json',
    JSON.stringify({ name: 'review', dependencies: { esbuild: '^0.28.0', peer: '1.0.0' } }),
  );
  return { vfs, registry, calls, files };
}
describe('range recipe metadata and replay', () => {
  for (const bundled of [false, true])
    it(`resolves and replays metadata bundled=${bundled}`, async () => {
      const f = await setup(bundled);
      const options = { vfs: f.vfs, cwd: '/p', registry: f.registry, runtimeTier: 'coi' as const };
      const installed = await install(options);
      const lock = await f.vfs.readFileText('/p/package-lock.json');
      expect(installed.lockfile.packages['node_modules/esbuild-wasm'].dependencies).toEqual({
        ordinary: '1.0.0',
      });
      expect(installed.lockfile.packages['node_modules/esbuild-wasm'].optionalDependencies).toEqual(
        { optional: '1.0.0' },
      );
      const prefix = bundled ? '/p/node_modules/esbuild-wasm/node_modules' : '/p/node_modules';
      for (const name of ['ordinary', 'optional'])
        expect(await f.vfs.readFileText(`${prefix}/${name}/index.js`)).toBe(
          `module.exports = ${JSON.stringify(name)};`,
        );
      for (const [path, bytes] of Object.entries(f.files))
        expect(
          Buffer.compare(await f.vfs.readFile(`/p/node_modules/esbuild-wasm/${path}`), bytes),
        ).toBe(0);
      await f.vfs.rm('/p/node_modules', { recursive: true });
      await install({ ...options, registry: undefined });
      expect(await f.vfs.readFileText('/p/package-lock.json')).toBe(lock);
      for (const name of ['ordinary', 'optional'])
        expect(await f.vfs.exists(`${prefix}/${name}/index.js`)).toBe(true);
    }, 30000);
  it('rejects metadata corruption before mutation', async () => {
    const f = await setup();
    const options = { vfs: f.vfs, cwd: '/p', registry: f.registry, runtimeTier: 'coi' as const };
    await install(options);
    const lock = JSON.parse(await f.vfs.readFileText('/p/package-lock.json'));
    lock.packages['node_modules/esbuild-wasm'].dependencies.ordinary = '2.0.0';
    const bad = JSON.stringify(lock);
    await f.vfs.writeFile('/p/package-lock.json', bad);
    await expect(install({ ...options, registry: undefined })).rejects.toMatchObject({
      code: 'EBROKENLOCK',
    });
    expect(await f.vfs.readFileText('/p/package-lock.json')).toBe(bad);
  }, 30000);
});
