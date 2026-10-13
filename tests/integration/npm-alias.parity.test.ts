import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryFs } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { unpackEddyBundle } from '../../packages/npm-client/src/eddy-bundle.ts';
import {
  bundleCompletenessGap,
  pinnedEntryForParent,
} from '../../packages/npm-client/src/installer-lockfile-reader.ts';
import { install } from '../../packages/npm-client/src/installer.ts';
import type { Lockfile } from '../../packages/npm-client/src/linker.ts';
import { RegistryClient, type VersionManifest } from '../../packages/npm-client/src/registry.ts';
import { createModuleLoader } from '../../packages/runtime-js/src/module-loader/index.ts';
import { resolveBundle } from '../../services/eddy/src/resolver.ts';

const fixtureRoot = new URL(
  '../../packages/npm-client/src/_test-fixtures/npm-alias/',
  import.meta.url,
);
const catalog = JSON.parse(await readFile(new URL('packages.json', fixtureRoot), 'utf8')) as Array<{
  name: string;
  version: string;
  file: string;
}>;
const packages = await Promise.all(
  catalog.map(async (entry) => {
    const manifest = JSON.parse(
      await readFile(new URL(`${entry.file}.json`, fixtureRoot), 'utf8'),
    ) as VersionManifest;
    const bytes = await readFile(new URL(`${entry.file}.tgz`, fixtureRoot));
    if (`sha512-${createHash('sha512').update(bytes).digest('base64')}` !== manifest.dist.integrity)
      throw new Error(`Original npm archive integrity drift: ${entry.name}`);
    return { manifest, bytes };
  }),
);

async function withRegistry(run: (url: string, requests: string[]) => Promise<void>) {
  const requests: string[] = [];
  let baseUrl = '';
  const server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', baseUrl).pathname);
    requests.push(pathname);
    const archive = packages.find(
      ({ manifest }) => new URL(manifest.dist.tarball).pathname === pathname,
    );
    if (archive) {
      res.end(archive.bytes);
      return;
    }
    const versions = packages.filter(({ manifest }) => `/${manifest.name}` === pathname);
    if (!versions.length) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        name: versions[0]!.manifest.name,
        'dist-tags': { latest: versions[0]!.manifest.version },
        versions: Object.fromEntries(
          versions.map(({ manifest }) => [
            manifest.version,
            {
              ...manifest,
              dist: {
                ...manifest.dist,
                tarball: baseUrl + new URL(manifest.dist.tarball).pathname,
              },
            },
          ]),
        ),
      }),
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('missing localhost registry address');
  baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run(baseUrl, requests);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

async function npmInstall(dir: string, url: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      'npm',
      [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        `--registry=${url}`,
        `--cache=${join(dir, 'cache')}`,
      ],
      { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`npm timeout: ${output}`));
    }, 20000);
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      clearTimeout(timeout);
      code === 0 ? resolve() : reject(new Error(`npm exit ${code}: ${output}`));
    });
  });
  return JSON.parse(await readFile(join(dir, 'package-lock.json'), 'utf8')) as Lockfile;
}

const scenarios = [
  {
    id: 'root, scoped, case-insensitive and range-less aliases',
    dependencies: {
      'root-alias': 'npm:string-width@4.2.3',
      'second-alias': 'npm:string-width@4.2.3',
      'string-width': '5.1.2',
      'scope-alias': 'npm:@types/estree@1.0.7',
      'tag-alias': 'NPM:strip-ansi@latest',
      'any-alias': 'npm:is-fullwidth-code-point',
    },
  },
  {
    id: 'cliui transitive CJS aliases beside ESM package identities',
    dependencies: { '@isaacs/cliui': '8.0.2' },
  },
  {
    id: 'npm alias override preserves the requested dependency path',
    dependencies: { '@isaacs/cliui': '8.0.2' },
    overrides: { 'strip-ansi-cjs': 'npm:strip-ansi@6.0.1' },
  },
] as const;

describe('npm aliases — real npm against original tarballs over localhost', () => {
  it.each(scenarios)(
    '[fault: sibling-drift / frozen-assumption] $id',
    async (scenario) =>
      withRegistry(async (url, requests) => {
        const dir = await mkdtemp(join(tmpdir(), 'rifty-npm-alias-'));
        const manifest = {
          name: 'alias-parity',
          version: '1.0.0',
          dependencies: scenario.dependencies,
          ...('overrides' in scenario ? { overrides: scenario.overrides } : {}),
        };
        try {
          await writeFile(join(dir, 'package.json'), JSON.stringify(manifest));
          const native = await npmInstall(dir, url);
          for (const replayNative of [false, true]) {
            const { vfs, fsSync } = createMemoryFs();
            await vfs.mkdir('/project', { recursive: true });
            await vfs.writeFile('/project/package.json', JSON.stringify(manifest));
            if (replayNative)
              await vfs.writeFile('/project/package-lock.json', JSON.stringify(native));
            const registry = new RegistryClient({ baseUrl: url, maxRetries: 0 });
            requests.length = 0;
            const actual = await install({ vfs, cwd: '/project', registry });
            const queue = Object.keys(scenario.dependencies).map((name) => ({
              name,
              nativeParent: '',
              actualParent: '',
            }));
            const seen = new Set<string>();
            for (let index = 0; index < queue.length; index++) {
              const edge = queue[index]!;
              const nativeHit = pinnedEntryForParent(native, edge.name, edge.nativeParent)!;
              const actualHit = pinnedEntryForParent(actual.lockfile, edge.name, edge.actualParent);
              expect(
                actualHit,
                `${scenario.id}: ${edge.name} from ${edge.actualParent}`,
              ).toBeDefined();
              const { entry, installPath: path } = nativeHit;
              expect(actualHit!.entry).toMatchObject({
                version: entry.version,
                resolved: entry.resolved,
                integrity: entry.integrity,
                ...(entry.name ? { name: entry.name } : {}),
              });
              expect(
                await vfs.readFileText(`/project/${actualHit!.installPath}/package.json`),
              ).toBe(await readFile(join(dir, path, 'package.json'), 'utf8'));
              if (replayNative) expect(actualHit!.installPath).toBe(path);
              const pair = `${path}\0${actualHit!.installPath}`;
              if (seen.has(pair)) continue;
              seen.add(pair);
              for (const name of Object.keys(entry.dependencies ?? {}))
                queue.push({ name, nativeParent: path, actualParent: actualHit!.installPath });
            }
            if (replayNative)
              expect(Object.keys(actual.lockfile.packages).sort()).toEqual(
                Object.keys(native.packages).sort(),
              );
            const loader = createModuleLoader(fsSync, { cwd: '/project' });
            const nativeRequire = createRequire(join(dir, 'entry.cjs'));
            if ('@isaacs/cliui' in scenario.dependencies) {
              const from = '/project/node_modules/@isaacs/cliui/entry.cjs';
              const nativeFrom = createRequire(join(dir, 'node_modules/@isaacs/cliui/entry.cjs'));
              // wrap-ansi loads ansi-styles' getter-only module.exports: separate runtime residual.
              for (const alias of ['string-width-cjs', 'strip-ansi-cjs']) {
                const value = loader.require(alias, from) as (
                  input: string,
                  ...args: unknown[]
                ) => unknown;
                const nativeValue = nativeFrom(alias) as typeof value;
                const args = alias === 'wrap-ansi-cjs' ? [5] : [];
                expect(value('a\u001b[31m中 b\u001b[0m', ...args)).toEqual(
                  nativeValue('a\u001b[31m中 b\u001b[0m', ...args),
                );
              }
            } else {
              const value = loader.require('root-alias', '/project/entry.cjs') as (
                s: string,
              ) => number;
              expect(value('中abc')).toEqual(nativeRequire('root-alias')('中abc'));
              expect(value).toBe(loader.require('root-alias', '/project/entry.cjs'));
              expect(value).not.toBe(loader.require('second-alias', '/project/entry.cjs'));
              expect(value).not.toBe(loader.require('string-width', '/project/entry.cjs'));
            }
            if (replayNative) expect(requests.filter((path) => !path.endsWith('.tgz'))).toEqual([]);
            requests.length = 0;
            const replay = await install({ vfs, cwd: '/project' });
            expect(replay.lockfile).toEqual(actual.lockfile);
            expect(requests).toEqual([]);
          }
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      }),
    60000,
  );
});

describe('npm alias identity faults', () => {
  it(
    '[fault: poisoned-cache / provenance-lie] Eddy harvests canonical targets once and validates alias locks',
    async () =>
      withRegistry(async (url) => {
        const dependencies = { first: 'npm:string-width@4.2.3', second: 'npm:string-width@4.2.3' };
        const resolved = await resolveBundle({ dependencies }, { registryBaseUrl: url });
        expect(resolved.kind).toBe('bundle');
        if (resolved.kind !== 'bundle') throw new Error(resolved.message);
        const bundle = unpackEddyBundle(resolved.bytes);
        const lock = JSON.parse(bundle.lockfileText) as Lockfile;
        expect(
          resolved.manifest.tarballs.filter((entry) => entry.name === 'string-width'),
        ).toHaveLength(1);
        expect(
          resolved.manifest.tarballs.some(
            (entry) => entry.name === 'first' || entry.name === 'second',
          ),
        ).toBe(false);
        expect(bundleCompletenessGap(lock, dependencies, resolved.manifest.tarballs)).toBeNull();
        expect(lock.packages['node_modules/first']?.name).toBe('string-width');
        expect(lock.packages['node_modules/second']?.name).toBe('string-width');
      }),
    60000,
  );

  it('[fault: corrupt-input] rejects non-registry alias targets before HTTP', async () =>
    withRegistry(async (url, requests) => {
      const { vfs } = createMemoryFs();
      await vfs.mkdir('/project', { recursive: true });
      await vfs.writeFile(
        '/project/package.json',
        JSON.stringify({ dependencies: { bad: 'npm:target@file:../local' } }),
      );
      await expect(
        install({ vfs, cwd: '/project', registry: new RegistryClient({ baseUrl: url }) }),
      ).rejects.toThrow('npm-client.dependency-spec.npm-alias-target');
      expect(requests).toEqual([]);
    }));

  it(
    '[fault: poisoned-cache] repairs a retained same-version alias with the wrong target identity',
    async () =>
      withRegistry(async (url, requests) => {
        const { vfs } = createMemoryFs();
        await vfs.mkdir('/project', { recursive: true });
        await vfs.writeFile(
          '/project/package.json',
          JSON.stringify({
            name: 'root',
            version: '1.0.0',
            dependencies: { alias: 'npm:string-width@4.2.3' },
          }),
        );
        const registry = new RegistryClient({ baseUrl: url, maxRetries: 0 });
        const first = await install({ vfs, cwd: '/project', registry });
        first.lockfile.packages['node_modules/alias']!.name = 'wrong-target';
        await vfs.writeFile('/project/package-lock.json', JSON.stringify(first.lockfile));
        requests.length = 0;
        const repaired = await install({ vfs, cwd: '/project', registry });
        expect(repaired.lockfile.packages['node_modules/alias']?.name).toBe('string-width');
        expect(requests).toContain('/string-width');
      }),
    60000,
  );
});
