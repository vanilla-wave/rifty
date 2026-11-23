import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { TARBALL_CACHE_ROOT, serializePackageJson } from '@riftydev/npm-client';
import type { CommandContext } from '@riftydev/shell';
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { produceDependencySnapshot } from '../glue/dep-snapshot-producer.ts';
import { parseNpmInstallRequest } from '../glue/npm-shell-command.ts';
import { SyncMirrorVfs } from '../glue/sync-mirror-vfs.ts';
import { applyNoCoiSnapshot } from './no-coi-snapshot-application.ts';
import { installToolchainPackages } from './no-coi-toolchain-install.ts';
import { type ExactFsTree, snapshotExactFsTree } from './test-fixtures/durable-owner-fs.ts';

const registryUrl = 'https://frozen-install-registry.test';
const assetUrl = 'https://host.test/lightning.tar.gz';
const fixtureRoot = new URL('../../../../tools/shadow-registry/src/fixtures/', import.meta.url);
const tarballUrl = `${registryUrl}/lightningcss-wasm/-/lightningcss-wasm-1.32.0.tgz`;

/** Byte-exact tree as digests: a failing diff stays printable for a multi-MB wasm payload. */
function digestTree(tree: ExactFsTree) {
  return {
    directories: tree.directories,
    files: Object.fromEntries(
      Object.entries(tree.files).map(([path, bytes]) => [
        path,
        createHash('sha256').update(bytes).digest('hex'),
      ]),
    ),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetSyncMirror();
});

/** Live registry serving the real LightningCSS shadow source; records every request. */
async function registry() {
  const metadata = JSON.parse(
    await readFile(new URL('lightningcss-wasm-1.32.0-registry.json', fixtureRoot), 'utf8'),
  ) as { readonly name: string; readonly version: string; readonly dist: object };
  const tarball = new Uint8Array(
    await readFile(new URL('lightningcss-wasm-1.32.0.tgz', fixtureRoot)),
  );
  const msRoot = new URL('../../../../tests/integration/fixtures/registry/', import.meta.url);
  const ms = JSON.parse(await readFile(new URL('ms-2.0.0.json', msRoot), 'utf8')) as {
    readonly dist: { readonly upstreamIntegrity: string };
  };
  const msTarball = new Uint8Array(await readFile(new URL('ms-2.0.0.tgz', msRoot)));
  const msTarballUrl = `${registryUrl}/ms/-/ms-2.0.0.tgz`;
  const requests: string[] = [];
  const assets = new Map<string, Uint8Array>();
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requests.push(url);
    const asset = assets.get(url);
    if (asset) return new Response(asset.slice());
    if (url === `${registryUrl}/lightningcss-wasm`)
      return Response.json({
        name: metadata.name,
        'dist-tags': { latest: metadata.version },
        versions: {
          [metadata.version]: { ...metadata, dist: { ...metadata.dist, tarball: tarballUrl } },
        },
      });
    if (url === tarballUrl) return new Response(tarball.slice());
    if (url === `${registryUrl}/ms`)
      return Response.json({
        name: 'ms',
        'dist-tags': { latest: '2.0.0' },
        versions: {
          '2.0.0': {
            name: 'ms',
            version: '2.0.0',
            dist: { tarball: msTarballUrl, integrity: ms.dist.upstreamIntegrity },
          },
        },
      });
    if (url === msTarballUrl) return new Response(msTarball.slice());
    throw new Error(`Unexpected request: ${url}`);
  });
  return { requests, assets };
}

async function applied(profile: 'replay' | 'frozen') {
  const network = await registry();
  const lock = JSON.parse(
    await readFile(
      new URL(
        '../../../../tests/e2e/fixtures/npm-lock-replay/vite8/package-lock.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as { readonly packages: Readonly<Record<string, unknown>> };
  const manifest = {
    name: 'frozen-install',
    version: '1.0.0',
    dependencies: { lightningcss: '^1.32.0' },
  };
  const produced = await produceDependencySnapshot({
    templateId: 'frozen-install',
    registryUrl,
    packageJsonText: serializePackageJson(manifest),
    packageLockText: JSON.stringify({
      name: manifest.name,
      version: manifest.version,
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': manifest,
        'node_modules/lightningcss': lock.packages['node_modules/lightningcss'],
      },
    }),
    profile,
  });
  network.assets.set(assetUrl, produced.archive);
  const fs = new MemoryFsSync();
  fs.mkdirSync('/project', { recursive: true });
  fs.writeFileSync(
    '/project/package.json',
    new TextEncoder().encode(serializePackageJson(manifest)),
  );
  await applyNoCoiSnapshot(
    {
      cwd: '/project',
      snapshot: { assetUrl, snapshotId: produced.snapshotId, templateId: 'frozen-install' },
    },
    { fs, flush: async () => undefined },
  );
  const vfs = new SyncMirrorVfs();
  setSyncMirror(fs, { async: vfs });
  network.requests.length = 0;
  return { fs, vfs, requests: network.requests };
}

function npmInstall(...specs: string[]) {
  const parsed = parseNpmInstallRequest(specs);
  if (parsed.status !== 'ready') throw new Error(parsed.message);
  const context = {
    cwd: '/project',
    stdout: { write: () => {} },
    stderr: { write: () => {} },
  } as unknown as CommandContext;
  return { request: parsed.request, context };
}

/** Same cold-cache texts as the Vite carrier, for the LightningCSS pin: terminal, then host. */
const terminalRefusal =
  /^EBROKENLOCK: package-lock\.json installs lightningcss@\S+ from its substitute lightningcss-wasm@\S+ \(shadow recipe \S+\), which is not in the tarball cache\. Lockfile replay takes substitutes only from that cache and never downloads them, so this lockfile cannot be reinstalled exactly here\. To install anyway, delete package-lock\.json and run install again: it re-resolves through the registry, and installed versions may change\.$/;
const hostRefusal = new RegExp(
  `${terminalRefusal.source.slice(0, -1)} Host exit: toolchain\\.applySnapshot with the replay-profile snapshot of these dependencies restores those bytes; toolchain\\.install then reinstalls this lockfile exactly\\.$`,
);

describe('explicit install after a prepared snapshot (ADR-0547 install semantics)', () => {
  it('frozen on a cold shared cache: shadow-pinned install fails loudly, fetches no tarball, leaves the tree', async () => {
    const { fs, vfs, requests } = await applied('frozen');
    expect(fs.existsSync(TARBALL_CACHE_ROOT)).toBe(false);
    const before = digestTree(snapshotExactFsTree(fs));
    await expect(installToolchainPackages({ cwd: '/project', registryUrl }, vfs)).rejects.toThrow(
      hostRefusal,
    );
    expect(requests, 'no registry/network fallback although the registry is live').toEqual([]);
    expect(digestTree(snapshotExactFsTree(fs)), 'applied tree and lock unchanged').toEqual(before);
  }, 30_000);

  it('frozen: adding an unrelated package still fails on the lock-replayed shadow pin', async () => {
    const { vfs, requests } = await applied('frozen');
    await expect(
      installToolchainPackages({ cwd: '/project', registryUrl }, vfs, npmInstall('ms@2.0.0')),
    ).rejects.toThrow(terminalRefusal);
    expect(
      requests.filter((url) => url.includes('lightningcss')),
      'the replayed pin is never fetched',
    ).toEqual([]);
  }, 30_000);

  it('frozen: naming the substituted root re-resolves it through the registry', async () => {
    const { vfs, requests } = await applied('frozen');
    const result = await installToolchainPackages(
      { cwd: '/project', registryUrl },
      vfs,
      npmInstall('lightningcss'),
    );
    expect(result.packages).toBeGreaterThan(0);
    expect(requests).toContain(tarballUrl);
  }, 30_000);

  it('replay: the same install replays the pinned bytes from the restored cache', async () => {
    const { vfs, requests } = await applied('replay');
    const result = await installToolchainPackages({ cwd: '/project', registryUrl }, vfs);
    expect(result.packages).toBeGreaterThan(0);
    expect(requests.filter((url) => url.endsWith('.tgz'))).toEqual([]);
  }, 30_000);
});
