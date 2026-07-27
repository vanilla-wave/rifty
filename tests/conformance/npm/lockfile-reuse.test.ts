/**
 * ADR-0023 conformance — lockfile reuse + tarball cache.
 *
 * First install: N packument + N tarball requests; lockfile + cache populated.
 * Second install with same `package.json`: 0 packument + 0 tarball requests
 * (everything served from the lockfile via the tarball cache).
 * One-package range bump: only that package re-resolves.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type Fetcher,
  type Packument,
  RegistryClient,
  TARBALL_CACHE_ROOT,
  install,
} from '@riftydev/npm-client';
import { MemoryVfs } from '@riftydev/vfs';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeLocalFetcher } from '../../integration/fixtures/local-registry.ts';

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

async function gzipAsync(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as unknown as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function makeTarGz(files: Record<string, string>): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const blocks: Uint8Array[] = [];
  for (const [path, content] of Object.entries(files)) {
    const data = enc.encode(content);
    const header = new Uint8Array(512);
    header.set(enc.encode(`package/${path}`), 0);
    header.set(enc.encode('0000644 '), 100);
    header.set(enc.encode('0000000 '), 108);
    header.set(enc.encode('0000000 '), 116);
    header.set(enc.encode(`${data.length.toString(8).padStart(11, '0')} `), 124);
    header.set(enc.encode('00000000000 '), 136);
    header.set(enc.encode('        '), 148);
    header[156] = 0x30;
    header.set(enc.encode('ustar  '), 257);
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += header[i] ?? 0;
    header.set(enc.encode(sum.toString(8).padStart(6, '0')), 148);
    header[154] = 0;
    header[155] = 0x20;
    blocks.push(header);
    blocks.push(data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad > 0) blocks.push(new Uint8Array(pad));
  }
  blocks.push(new Uint8Array(512));
  blocks.push(new Uint8Array(512));
  return await gzipAsync(concat(blocks));
}

interface CallCounters {
  packument: number;
  tarball: number;
}

async function makeCountingFetcher(
  packuments: Record<string, Packument>,
  tarballs: Record<string, Uint8Array>,
): Promise<{ fetch: Fetcher; calls: CallCounters }> {
  const calls: CallCounters = { packument: 0, tarball: 0 };
  const fetch: Fetcher = async (url: string): Promise<Response> => {
    if (url.startsWith('tarball:')) {
      calls.tarball++;
      const data = tarballs[url];
      if (!data) return new Response('', { status: 404 });
      return new Response(data as unknown as BodyInit, { status: 200 });
    }
    if (url.startsWith('packument:')) {
      calls.packument++;
      const name = url.slice('packument:'.length).replace(/^\/+/, '');
      const p = packuments[name];
      if (!p) return new Response('', { status: 404 });
      return new Response(JSON.stringify(p), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('', { status: 404 });
  };
  return { fetch, calls };
}

type DriftLock = {
  packages: Record<string, { version?: string; dependencies?: Record<string, string> }>;
};

type InstalledPackageIdentity = Readonly<{
  name: string;
  version: string;
}>;

type InstalledTreeSummary = Readonly<Record<string, InstalledPackageIdentity>>;

function runNpm(cwd: string, args: string[], registry: string) {
  return new Promise<{ code: number; output: string }>((resolve, reject) => {
    const child = spawn('npm', args, {
      cwd,
      env: {
        ...process.env,
        npm_config_cache: join(cwd, '.npm-cache'),
        npm_config_registry: registry,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      output += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, output }));
  });
}

function readNativeInstalledTree(
  cwd: string,
  packageJsonPaths: readonly string[],
): InstalledTreeSummary {
  const summary: Record<string, InstalledPackageIdentity> = {};
  for (const relativePath of packageJsonPaths) {
    const path = join(cwd, relativePath);
    if (!existsSync(path)) continue;
    let manifest: { name?: unknown; version?: unknown };
    try {
      manifest = JSON.parse(readFileSync(path, 'utf8')) as {
        name?: unknown;
        version?: unknown;
      };
    } catch {
      // The interruption probe intentionally races npm's real file writes.
      // An existing-but-not-yet-complete package.json is itself observable
      // proof that the package-tree mutation is in flight.
      summary[relativePath] = { name: '<incomplete>', version: '<incomplete>' };
      continue;
    }
    if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
      throw new Error(`installed package identity missing at ${relativePath}`);
    }
    summary[relativePath] = { name: manifest.name, version: manifest.version };
  }
  return summary;
}

async function readRiftyInstalledTree(
  vfs: MemoryVfs,
  root: string,
  packageJsonPaths: readonly string[],
): Promise<InstalledTreeSummary> {
  const summary: Record<string, InstalledPackageIdentity> = {};
  for (const relativePath of packageJsonPaths) {
    const path = `${root}/${relativePath}`;
    if (!(await vfs.exists(path))) continue;
    const manifest = JSON.parse(await vfs.readFileText(path)) as {
      name?: unknown;
      version?: unknown;
    };
    if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
      throw new Error(`installed package identity missing at ${relativePath}`);
    }
    summary[relativePath] = { name: manifest.name, version: manifest.version };
  }
  return summary;
}

function installedCount(summary: InstalledTreeSummary): number {
  return Object.keys(summary).length;
}

async function waitForRiftyPartialTree(
  vfs: MemoryVfs,
  root: string,
  packageJsonPaths: readonly string[],
): Promise<InstalledTreeSummary> {
  for (let attempt = 0; attempt < 100_000; attempt++) {
    const summary = await readRiftyInstalledTree(vfs, root, packageJsonPaths);
    const count = installedCount(summary);
    if (count > 0 && count < packageJsonPaths.length) return summary;
    if (count === packageJsonPaths.length) {
      throw new Error('rifty completed the package tree before cancellation could interrupt it');
    }
    await Promise.resolve();
  }
  throw new Error('rifty did not expose a partial package tree');
}

async function startFixtureRegistry() {
  const fixtureFetch = makeLocalFetcher().fetch;
  let origin = '';
  let requests = 0;
  const server = createServer((request, response) => {
    requests++;
    void (async () => {
      const path = decodeURIComponent(new URL(request.url ?? '/', 'http://fixture').pathname);
      const served = await fixtureFetch(
        path.startsWith('/tarball:') ? path.slice(1) : `packument:${path}`,
      );
      response.statusCode = served.status;
      if (!served.ok) return response.end();
      if (path.startsWith('/tarball:'))
        return response.end(Buffer.from(await served.arrayBuffer()));
      const packument = (await served.json()) as Packument;
      for (const manifest of Object.values(packument.versions)) {
        manifest.dist.tarball = `${origin}/${manifest.dist.tarball}`;
      }
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(packument));
    })().catch((error: unknown) => {
      response.statusCode = 500;
      response.end(String(error));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture registry has no TCP port');
  origin = `http://127.0.0.1:${address.port}`;
  return { origin, server, requestCount: () => requests };
}

function driftSummary(lock: DriftLock, treeVersion: string) {
  return {
    edge: lock.packages['node_modules/diamond-conflict-parent']?.dependencies?.ms,
    pin: lock.packages['node_modules/ms']?.version,
    tree: treeVersion,
  };
}

describe('install — lockfile reuse (ADR-0023)', () => {
  let vfs: MemoryVfs;
  let packuments: Record<string, Packument>;
  let tarballs: Record<string, Uint8Array>;

  beforeEach(async () => {
    vfs = new MemoryVfs();
    const tinyV1 = await makeTarGz({
      'package.json': JSON.stringify({ name: 'tiny', version: '1.0.0' }),
      'index.js': 'module.exports = 1;',
    });
    const wrapperV2 = await makeTarGz({
      'package.json': JSON.stringify({
        name: 'wrapper',
        version: '2.0.0',
        dependencies: { tiny: '^1.0.0' },
      }),
      'index.js': "module.exports = require('tiny') + 1;",
    });
    const wrapperV3 = await makeTarGz({
      'package.json': JSON.stringify({
        name: 'wrapper',
        version: '3.0.0',
        dependencies: { tiny: '^1.0.0' },
      }),
      'index.js': "module.exports = require('tiny') + 2;",
    });
    const addedV1 = await makeTarGz({
      'package.json': JSON.stringify({ name: 'added', version: '1.0.0' }),
      'index.js': 'module.exports = 3;',
    });
    tarballs = {
      'tarball:tiny-1.0.0.tgz': tinyV1,
      'tarball:wrapper-2.0.0.tgz': wrapperV2,
      'tarball:wrapper-3.0.0.tgz': wrapperV3,
      'tarball:added-1.0.0.tgz': addedV1,
    };
    packuments = {
      tiny: {
        name: 'tiny',
        versions: {
          '1.0.0': {
            name: 'tiny',
            version: '1.0.0',
            dist: { tarball: 'tarball:tiny-1.0.0.tgz' },
          },
        },
      },
      wrapper: {
        name: 'wrapper',
        versions: {
          '2.0.0': {
            name: 'wrapper',
            version: '2.0.0',
            dependencies: { tiny: '^1.0.0' },
            dist: { tarball: 'tarball:wrapper-2.0.0.tgz' },
          },
          '3.0.0': {
            name: 'wrapper',
            version: '3.0.0',
            dependencies: { tiny: '^1.0.0' },
            dist: { tarball: 'tarball:wrapper-3.0.0.tgz' },
          },
        },
      },
      added: {
        name: 'added',
        versions: {
          '1.0.0': {
            name: 'added',
            version: '1.0.0',
            dist: { tarball: 'tarball:added-1.0.0.tgz' },
          },
        },
      },
    };
  });

  it('second install with unchanged deps issues no packument or tarball calls', async () => {
    const { fetch, calls } = await makeCountingFetcher(packuments, tarballs);
    const registry = new RegistryClient({ baseUrl: 'packument:', fetch });

    await install('root', '0.0.0', { wrapper: '^2.0.0' }, { vfs, cwd: '/app', registry });
    expect(calls.packument).toBe(2); // wrapper + tiny
    expect(calls.tarball).toBe(2);

    calls.packument = 0;
    calls.tarball = 0;
    await install('root', '0.0.0', { wrapper: '^2.0.0' }, { vfs, cwd: '/app', registry });
    expect(calls.packument).toBe(0);
    expect(calls.tarball).toBe(0);
  });

  it('populates the tarball cache and serves on second install', async () => {
    const { fetch } = await makeCountingFetcher(packuments, tarballs);
    const registry = new RegistryClient({ baseUrl: 'packument:', fetch });

    await install('root', '0.0.0', { tiny: '^1.0.0' }, { vfs, cwd: '/app', registry });
    expect(await vfs.exists(TARBALL_CACHE_ROOT)).toBe(true);

    // The cached file must exist under the prefix layout for tiny@1.0.0.
    const entries = await vfs.readdir(TARBALL_CACHE_ROOT);
    expect(entries.length).toBeGreaterThan(0);
    // One of the entries must be a directory (the SHA-prefix bucket).
    expect(entries.some((e) => e.isDirectory)).toBe(true);
  });

  it('range bump on one dep re-resolves only the affected subgraph', async () => {
    const { fetch, calls } = await makeCountingFetcher(packuments, tarballs);
    const registry = new RegistryClient({ baseUrl: 'packument:', fetch });

    await install('root', '0.0.0', { wrapper: '^2.0.0' }, { vfs, cwd: '/app', registry });
    calls.packument = 0;
    calls.tarball = 0;

    // Bump wrapper to ^3.0.0 — tiny still satisfies its old pin and is replayed
    // without consulting moving registry metadata.
    await install('root', '0.0.0', { wrapper: '^3.0.0' }, { vfs, cwd: '/app', registry });
    expect(calls.packument).toBe(1);
    // tiny's tarball is served from cache; wrapper@3.0.0 is a new tarball.
    expect(calls.tarball).toBe(1);
  });

  it('adding one direct dependency keeps the existing subgraph locked', async () => {
    const { fetch, calls } = await makeCountingFetcher(packuments, tarballs);
    const registry = new RegistryClient({ baseUrl: 'packument:', fetch });

    await install('root', '0.0.0', { wrapper: '^2.0.0' }, { vfs, cwd: '/app', registry });
    calls.packument = 0;
    calls.tarball = 0;

    await install(
      'root',
      '0.0.0',
      { wrapper: '^2.0.0', added: '1.0.0' },
      { vfs, cwd: '/app', registry },
    );
    expect(calls.packument).toBe(1);
    expect(calls.tarball).toBe(1);
  });

  it('integrity mismatch on a cached tarball forces a refetch (corruption guard)', async () => {
    const { fetch } = await makeCountingFetcher(packuments, tarballs);
    const registry = new RegistryClient({ baseUrl: 'packument:', fetch });

    await install('root', '0.0.0', { tiny: '^1.0.0' }, { vfs, cwd: '/app', registry });

    // Corrupt the cached tarball by overwriting it.
    const root = TARBALL_CACHE_ROOT;
    async function findFirstFile(dir: string): Promise<string | null> {
      for (const ent of await vfs.readdir(dir)) {
        const path = `${dir}/${ent.name}`;
        if (ent.isDirectory) {
          const inner = await findFirstFile(path);
          if (inner) return inner;
        } else if (path.endsWith('.tgz')) {
          return path;
        }
      }
      return null;
    }
    const cachedPath = await findFirstFile(root);
    expect(cachedPath).not.toBeNull();
    await vfs.writeFile(cachedPath!, new Uint8Array([1, 2, 3, 4, 5]));

    // Second install must detect the integrity mismatch and refetch from
    // the registry (1 tarball call), then repair the cache.
    const { fetch: fetch2, calls: calls2 } = await makeCountingFetcher(packuments, tarballs);
    const registry2 = new RegistryClient({ baseUrl: 'packument:', fetch: fetch2 });
    await install('root', '0.0.0', { tiny: '^1.0.0' }, { vfs, cwd: '/app', registry: registry2 });
    expect(calls2.tarball).toBe(1);
  });
});

describe('install — transitive lockfile range drift parity', () => {
  it('[fault: frozen-assumption] matches npm install repair while npm ci rejects', async () => {
    const { origin, server } = await startFixtureRegistry();
    const workspace = mkdtempSync(join(tmpdir(), 'rifty-range-drift-'));
    const request = { 'diamond-conflict-parent': '1.0.0' };
    const rootPackage = JSON.stringify({
      name: 'range-drift-probe',
      version: '1.0.0',
      private: true,
      dependencies: request,
    });
    try {
      writeFileSync(join(workspace, 'package.json'), rootPackage);
      const flags = ['--ignore-scripts', '--no-audit', '--no-fund'];
      expect((await runNpm(workspace, ['install', ...flags], origin)).code).toBe(0);
      const lockPath = join(workspace, 'package-lock.json');
      const drifted = JSON.parse(readFileSync(lockPath, 'utf8')) as DriftLock;
      const parent = drifted.packages['node_modules/diamond-conflict-parent'];
      if (!parent?.dependencies) throw new Error('npm seed lock missing parent edge');
      parent.dependencies.ms = '2.1.3';
      const driftText = JSON.stringify(drifted);
      writeFileSync(lockPath, driftText);
      const ci = await runNpm(workspace, ['ci', '--dry-run', ...flags], origin);
      expect(ci.code).not.toBe(0);
      expect(ci.output).toMatch(/ms@2\.0\.0 does not satisfy ms@2\.1\.3/);
      expect(readFileSync(lockPath, 'utf8')).toBe(driftText);
      expect((await runNpm(workspace, ['install', ...flags], origin)).code).toBe(0);
      const nodeLock = JSON.parse(readFileSync(lockPath, 'utf8')) as DriftLock;
      const nodeTree = JSON.parse(
        readFileSync(join(workspace, 'node_modules/ms/package.json'), 'utf8'),
      ) as { version: string };
      const vfs = new MemoryVfs();
      await vfs.mkdir('/app', { recursive: true });
      await vfs.writeFile('/app/package-lock.json', driftText);
      const rifty = await install('range-drift-probe', '1.0.0', request, {
        vfs,
        cwd: '/app',
        registry: new RegistryClient({ baseUrl: origin }),
      });
      const riftyTree = JSON.parse(await vfs.readFileText('/app/node_modules/ms/package.json')) as {
        version: string;
      };
      expect(driftSummary(rifty.lockfile, riftyTree.version)).toEqual(
        driftSummary(nodeLock, nodeTree.version),
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(workspace, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('install — interrupted tree repair parity', () => {
  // Oracle recorded 2026-07-24: Node v24.16.0, npm 11.17.0.
  it('[fault: torn-state] reconciles a partial tree from the existing lockfile and cache', async () => {
    const { origin, server, requestCount } = await startFixtureRegistry();
    const workspace = mkdtempSync(join(tmpdir(), 'rifty-interrupted-install-'));
    const root = '/app';
    const request = {
      debug: '^4.4.1',
      'diamond-conflict-parent': '1.0.0',
      kleur: '4.1.5',
      picocolors: '1.0.0',
    };
    const packageJsonPaths = [
      'node_modules/debug/package.json',
      'node_modules/ms/package.json',
      'node_modules/diamond-conflict-parent/package.json',
      'node_modules/diamond-conflict-parent/node_modules/ms/package.json',
      'node_modules/kleur/package.json',
      'node_modules/picocolors/package.json',
    ] as const;
    const rootPackage = JSON.stringify({
      name: 'interrupted-install-probe',
      version: '1.0.0',
      private: true,
      dependencies: request,
    });
    const flags = ['--ignore-scripts', '--no-audit', '--no-fund'];
    try {
      writeFileSync(join(workspace, 'package.json'), rootPackage);
      expect((await runNpm(workspace, ['install', ...flags], origin)).code).toBe(0);
      const nativeLockPath = join(workspace, 'package-lock.json');
      const nativeLockText = readFileSync(nativeLockPath, 'utf8');
      const expectedNativeTree = readNativeInstalledTree(workspace, packageJsonPaths);
      expect(installedCount(expectedNativeTree)).toBe(packageJsonPaths.length);

      const vfs = new MemoryVfs();
      await vfs.mkdir(root, { recursive: true });
      await vfs.writeFile(`${root}/package.json`, rootPackage);
      await install({
        vfs,
        cwd: root,
        registry: new RegistryClient({ baseUrl: origin }),
      });
      const riftyLockText = await vfs.readFileText(`${root}/package-lock.json`);
      const expectedRiftyTree = await readRiftyInstalledTree(vfs, root, packageJsonPaths);
      expect(expectedRiftyTree).toEqual(expectedNativeTree);
      const registryRequestsAfterSeed = requestCount();

      // Persisted torn state is the repair input; SIGSTOP polling races npm's
      // sub-millisecond mutation window and tests host scheduling instead.
      rmSync(join(workspace, 'node_modules/debug'), { recursive: true });
      rmSync(join(workspace, 'node_modules/kleur'), { recursive: true });
      const nativePartial = readNativeInstalledTree(workspace, packageJsonPaths);
      expect(Object.keys(nativePartial)).toEqual([
        'node_modules/ms/package.json',
        'node_modules/diamond-conflict-parent/package.json',
        'node_modules/diamond-conflict-parent/node_modules/ms/package.json',
        'node_modules/picocolors/package.json',
      ]);
      expect(readFileSync(nativeLockPath, 'utf8')).toBe(nativeLockText);

      await vfs.rm(`${root}/node_modules`, { recursive: true });
      let riftyRegistryCalls = 0;
      const offlineRegistry = new RegistryClient({
        baseUrl: origin,
        maxRetries: 0,
        fetch: async () => {
          riftyRegistryCalls++;
          throw new Error('interrupted-install repair attempted network');
        },
      });
      const controller = new AbortController();
      const reason = new Error('interrupt package-tree mutation');
      let markLinkReady!: () => void;
      const linkReady = new Promise<void>((resolve) => {
        markLinkReady = resolve;
      });
      const interruptedRifty = install({
        vfs,
        cwd: root,
        registry: offlineRegistry,
        signal: controller.signal,
        assertPortablePaths: () => markLinkReady(),
      });
      await linkReady;
      await waitForRiftyPartialTree(vfs, root, packageJsonPaths);
      controller.abort(reason);
      await expect(interruptedRifty).rejects.toBe(reason);
      const riftyPartial = await readRiftyInstalledTree(vfs, root, packageJsonPaths);
      expect(installedCount(riftyPartial)).toBeGreaterThan(0);
      expect(installedCount(riftyPartial)).toBeLessThan(packageJsonPaths.length);
      expect(await vfs.readFileText(`${root}/package-lock.json`)).toBe(riftyLockText);

      expect((await runNpm(workspace, ['install', '--offline', ...flags], origin)).code).toBe(0);
      const repairedNativeTree = readNativeInstalledTree(workspace, packageJsonPaths);
      expect(repairedNativeTree).toEqual(expectedNativeTree);
      expect(readFileSync(nativeLockPath, 'utf8')).toBe(nativeLockText);

      const repairedRifty = await install({
        vfs,
        cwd: root,
        registry: offlineRegistry,
      });
      expect(repairedRifty.provenance.resolution).toBe('lockfile');
      expect(
        repairedRifty.provenance.packages.every(({ transport }) => transport === 'cache'),
      ).toBe(true);
      expect(riftyRegistryCalls).toBe(0);
      expect(requestCount()).toBe(registryRequestsAfterSeed);
      expect(await readRiftyInstalledTree(vfs, root, packageJsonPaths)).toEqual(expectedRiftyTree);
      expect(await vfs.readFileText(`${root}/package-lock.json`)).toBe(riftyLockText);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(workspace, { recursive: true, force: true });
    }
  }, 30_000);
});
