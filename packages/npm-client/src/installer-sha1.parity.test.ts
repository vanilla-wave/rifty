import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { MemoryVfs } from '@riftydev/vfs';
import { expect, it } from 'vitest';
import { makePackageTarball } from './_test-fixtures/tar-builder.ts';
import { fetchAndUnpackToCache } from './fetch-and-unpack.ts';
import { install } from './installer.ts';
import { RegistryClient } from './registry.ts';
import { VfsTarballCache, computeIntegrity, tarballCachePath } from './tarball-cache.ts';

const exec = promisify(execFile);

it('replays npm SHA-1 locks, rechecks cached bytes and rejects corrupt network bytes', async () => {
  const bytes = await makePackageTarball('legacy-sha1', '1.0.0');
  const integrity = `sha1-${createHash('sha1').update(bytes).digest('base64')}`;
  let body = bytes;
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No registry address');
  const origin = `http://127.0.0.1:${address.port}`;
  const resolved = `${origin}/legacy-sha1.tgz`;
  const root = await mkdtemp(join(tmpdir(), 'rifty-sha1-parity-'));
  const manifest = JSON.stringify({
    name: 'root',
    version: '1.0.0',
    dependencies: { 'legacy-sha1': '1.0.0' },
  });
  const lock = JSON.stringify({
    name: 'root',
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': { name: 'root', version: '1.0.0', dependencies: { 'legacy-sha1': '1.0.0' } },
      'node_modules/legacy-sha1': { version: '1.0.0', resolved, integrity },
    },
  });
  const nativeInstall = () =>
    exec(
      'npm',
      [
        'ci',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--fetch-retries=0',
        `--registry=${origin}`,
        `--cache=${join(root, 'cache')}`,
      ],
      { cwd: root, timeout: 30000 },
    );
  try {
    await writeFile(join(root, 'package.json'), manifest);
    await writeFile(join(root, 'package-lock.json'), lock);
    await nativeInstall();
    const native = JSON.parse(
      await readFile(join(root, 'node_modules/legacy-sha1/package.json'), 'utf8'),
    );
    const vfs = new MemoryVfs();
    await vfs.mkdir('/project', { recursive: true });
    await vfs.writeFile('/project/package.json', manifest);
    await vfs.writeFile('/project/package-lock.json', lock);
    const registry = new RegistryClient({ baseUrl: origin });
    await install({ vfs, cwd: '/project', registry });
    expect(
      JSON.parse(await vfs.readFileText('/project/node_modules/legacy-sha1/package.json')),
    ).toEqual(native);
    expect(await computeIntegrity(bytes, 'sha1')).toBe(integrity);
    const cache = new VfsTarballCache(vfs);
    const spec = { name: 'legacy-sha1', version: '1.0.0', resolved, integrity };
    const ctx = { cache, getTarball: (url: string) => registry.getTarball(url) };
    const beforeHit = requests;
    expect((await fetchAndUnpackToCache(spec, ctx)).cacheHit).toBe(true);
    expect(requests).toBe(beforeHit);
    await vfs.writeFile(tarballCachePath(spec.name, spec.version, integrity), new Uint8Array([1]));
    expect((await fetchAndUnpackToCache(spec, ctx)).cacheHit).toBe(false);
    expect(requests).toBe(beforeHit + 1);
    body = new Uint8Array([1, 2, 3]);
    await rm(join(root, 'cache'), { recursive: true, force: true });
    await expect(nativeInstall()).rejects.toMatchObject({
      stderr: expect.stringContaining('EINTEGRITY'),
    });
    await vfs.writeFile(tarballCachePath(spec.name, spec.version, integrity), body);
    await expect(fetchAndUnpackToCache(spec, ctx)).rejects.toMatchObject({
      code: 'EINTEGRITY',
      expected: integrity,
    });
    expect(await cache.get(spec.name, spec.version, integrity)).toBeNull();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
