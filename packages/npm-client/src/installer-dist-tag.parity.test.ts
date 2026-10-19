import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { MemoryVfs } from '@riftydev/vfs';
import { expect, it } from 'vitest';
import { makePackageTarball } from './_test-fixtures/tar-builder.ts';
import { install } from './installer.ts';
import type { Lockfile } from './linker.ts';
import { RegistryClient } from './registry.ts';

const exec = promisify(execFile);

/**
 * npm resolves `"pkg": "<dist-tag>"` from the packument and its lock keeps that
 * pin offline even after the tag moves (Arborist dep-valid: a tag spec is
 * satisfied by any registry-resolved node). rifty's replay rechecks the spec as
 * a range, so a non-`latest` tag is a declared ceiling: loud, before any write.
 * TODO(backlog: npm-client/dist-tag-dependency-spec-replay)
 */
it('[fault: provenance-lie] non-latest dist-tag spec: npm installs and replays the pin; rifty refuses loudly before writing', async () => {
  const tarballs = new Map<string, Uint8Array>();
  for (const v of ['1.0.0', '2.0.0', '3.0.0'])
    tarballs.set(v, await makePackageTarball('tagged', v));
  let next = '2.0.0';
  const requests: string[] = [];
  let origin = '';
  const server = createServer((req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://registry.invalid');
    requests.push(pathname);
    const tarball = /^\/tagged\/-\/tagged-(.+)\.tgz$/.exec(pathname);
    if (tarball) {
      res.end(tarballs.get(tarball[1]!));
      return;
    }
    if (pathname !== '/tagged') {
      res.writeHead(404);
      res.end('{}');
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        name: 'tagged',
        'dist-tags': { latest: '1.0.0', next },
        versions: Object.fromEntries(
          [...tarballs.keys()].map((version) => [
            version,
            {
              name: 'tagged',
              version,
              dist: { tarball: `${origin}/tagged/-/tagged-${version}.tgz` },
            },
          ]),
        ),
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No registry address');
  origin = `http://127.0.0.1:${address.port}`;
  const root = await mkdtemp(join(tmpdir(), 'rifty-dist-tag-parity-'));
  const manifest = JSON.stringify({
    name: 'root',
    version: '1.0.0',
    dependencies: { tagged: 'next' },
  });
  const nativeInstall = () =>
    exec(
      'npm',
      [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--fetch-retries=0',
        `--registry=${origin}`,
        `--cache=${join(root, 'cache')}`,
      ],
      { cwd: root, timeout: 30000 },
    );
  const nativeLock = async () =>
    JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8')) as Lockfile;
  try {
    await writeFile(join(root, 'package.json'), manifest);
    await nativeInstall();
    expect((await nativeLock()).packages['node_modules/tagged']!.version).toBe('2.0.0');
    // Tag moves; npm with its lock keeps 2.0.0 without consulting the registry.
    next = '3.0.0';
    requests.length = 0;
    await nativeInstall();
    const retained = await nativeLock();
    expect(retained.packages['node_modules/tagged']!.version).toBe('2.0.0');
    expect(requests.filter((path) => !path.endsWith('.tgz'))).toEqual([]);

    const registry = new RegistryClient({ baseUrl: origin, maxRetries: 0 });
    const ceiling = /npm-client\.dependency-spec\.dist-tag/;
    for (const replayNative of [false, true]) {
      const vfs = new MemoryVfs();
      await vfs.mkdir('/project', { recursive: true });
      await vfs.writeFile('/project/package.json', manifest);
      if (replayNative) await vfs.writeFile('/project/package-lock.json', JSON.stringify(retained));
      requests.length = 0;
      await expect(install({ vfs, cwd: '/project', registry })).rejects.toThrow(ceiling);
      expect(requests.filter((path) => path.endsWith('.tgz'))).toEqual([]);
      expect(await vfs.exists('/project/node_modules/tagged')).toBe(false);
      if (replayNative)
        expect(await vfs.readFileText('/project/package-lock.json')).toBe(JSON.stringify(retained));
      else expect(await vfs.exists('/project/package-lock.json')).toBe(false);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
