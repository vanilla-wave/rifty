import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { TARBALL_CACHE_ROOT } from '@riftydev/npm-client';
import type { CommandContext } from '@riftydev/shell';
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseNpmInstallRequest } from '../glue/npm-shell-command.ts';
import { SyncMirrorVfs } from '../glue/sync-mirror-vfs.ts';
import { applyNoCoiSnapshot } from './no-coi-snapshot-application.ts';
import { installToolchainPackages } from './no-coi-toolchain-install.ts';
import { type ExactFsTree, snapshotExactFsTree } from './test-fixtures/durable-owner-fs.ts';

const registryUrl = 'https://registry.npmjs.org';
const assetUrl = 'https://host.test/vite.json';
const repo = new URL('../../../../', import.meta.url);
const fixtures = new URL('tests/integration/fixtures/registry/', repo);

afterEach(() => {
  vi.unstubAllGlobals();
  resetSyncMirror();
});

function digestTree(tree: ExactFsTree, under: string) {
  return Object.fromEntries(
    Object.entries(tree.files)
      .filter(([path]) => path.startsWith(under))
      .map(([path, bytes]) => [path, createHash('sha256').update(bytes).digest('hex')]),
  );
}

/** Live registry over the original npm archives of the committed Vite snapshot (+ ms). */
async function registry() {
  const provenance = JSON.parse(
    await readFile(new URL('rollup-companions/provenance.json', fixtures), 'utf8'),
  ) as {
    readonly packages: readonly {
      readonly name: string;
      readonly version: string;
      readonly file: string;
      readonly tarball: string;
    }[];
  };
  const tarballs = new Map<string, Uint8Array>();
  const packuments = new Map<string, Record<string, unknown>>();
  for (const item of provenance.packages) {
    const base = new URL(`rollup-companions/packages/${item.file}`, fixtures);
    tarballs.set(item.tarball, new Uint8Array(await readFile(`${base.pathname}.tgz`)));
    const manifest = JSON.parse(await readFile(`${base.pathname}.json`, 'utf8')) as object;
    const packument = packuments.get(item.name) ?? {
      name: item.name,
      'dist-tags': { latest: item.version },
      versions: {},
    };
    (packument.versions as Record<string, object>)[item.version] = manifest;
    packuments.set(item.name, packument);
  }
  const ms = JSON.parse(await readFile(new URL('ms-2.0.0.json', fixtures), 'utf8')) as {
    readonly dist: { readonly upstreamTarball: string; readonly upstreamIntegrity: string };
  };
  tarballs.set(
    ms.dist.upstreamTarball,
    new Uint8Array(await readFile(new URL('ms-2.0.0.tgz', fixtures))),
  );
  packuments.set('ms', {
    name: 'ms',
    'dist-tags': { latest: '2.0.0' },
    versions: {
      '2.0.0': {
        name: 'ms',
        version: '2.0.0',
        dist: { tarball: ms.dist.upstreamTarball, integrity: ms.dist.upstreamIntegrity },
      },
    },
  });
  const requests: string[] = [];
  const assets = new Map<string, Uint8Array>();
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requests.push(url);
    const bytes = assets.get(url) ?? tarballs.get(url);
    if (bytes) return new Response(bytes.slice());
    const name = decodeURIComponent(url.slice(`${registryUrl}/`.length));
    const packument = url.startsWith(`${registryUrl}/`) ? packuments.get(name) : undefined;
    if (packument) return Response.json(packument);
    return new Response('not found', { status: 404 });
  });
  return { requests, assets };
}

async function applied(profile: 'replay' | 'compact') {
  const network = await registry();
  const baked = JSON.parse(
    gunzipSync(
      await readFile(new URL('apps/playground/public/snapshots/vite-node-modules.json.gz', repo)),
    ).toString('utf8'),
  ) as Record<string, unknown> & { readonly packageJsonText: string };
  const source =
    profile === 'replay'
      ? baked
      : {
          ...baked,
          version: 5,
          profile: 'compact',
          tarballCache: { version: 1, root: TARBALL_CACHE_ROOT, files: [] },
        };
  const bytes = new TextEncoder().encode(JSON.stringify(source));
  network.assets.set(assetUrl, bytes);
  const fs = new MemoryFsSync();
  fs.mkdirSync('/project', { recursive: true });
  fs.writeFileSync('/project/package.json', new TextEncoder().encode(baked.packageJsonText));
  await applyNoCoiSnapshot(
    {
      cwd: '/project',
      snapshot: {
        assetUrl,
        snapshotId: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
        templateId: 'vite',
      },
    },
    { fs, flush: async () => undefined },
  );
  const vfs = new SyncMirrorVfs();
  setSyncMirror(fs, { async: vfs });
  network.requests.length = 0;
  return { fs, vfs, requests: network.requests };
}

function npm(...specs: string[]) {
  const parsed = parseNpmInstallRequest(specs);
  if (parsed.status !== 'ready') throw new Error(parsed.message);
  const context = {
    cwd: '/project',
    stdout: { write: () => {} },
    stderr: { write: () => {} },
  } as unknown as CommandContext;
  return { request: parsed.request, context };
}

describe('Vite 7.3.6 after compact on a cold cache: no npm reinstall route while the lock is kept (ADR-0547)', () => {
  it.each([
    ['install over the lock', [] as string[], 11],
    ['npm install esbuild (the transitive shadow pin)', ['esbuild'], 11],
    ['npm install ms (an unrelated package)', ['ms@2.0.0'], 12],
  ] as const)(
    '%s fails EBROKENLOCK on esbuild; ordinary tarballs reach the shared cache, project tree unchanged',
    async (_label, specs, ordinary) => {
      const { fs, vfs, requests } = await applied('compact');
      const before = digestTree(snapshotExactFsTree(fs), '/project/');
      await expect(
        installToolchainPackages(
          { cwd: '/project', registryUrl },
          vfs,
          ...(specs.length === 0 ? [] : [npm(...specs)]),
        ),
      ).rejects.toThrow(
        /^EBROKENLOCK: shadow recipe rifty\.shadow-substitution\.esbuild\.v2 is missing its pinned cache bytes$/,
      );
      const fetched = requests.filter((url) => url.endsWith('.tgz'));
      expect(fetched, 'ordinary lock/request tarballs fetched before the refusal').toHaveLength(
        ordinary,
      );
      expect(
        fetched.filter((url) => url.includes('esbuild')),
        'shadow bytes never fetched',
      ).toEqual([]);
      expect(
        Object.keys(digestTree(snapshotExactFsTree(fs), `${TARBALL_CACHE_ROOT}/`)),
      ).toHaveLength(ordinary);
      expect(digestTree(snapshotExactFsTree(fs), '/project/'), 'project tree unchanged').toEqual(
        before,
      );
    },
    60_000,
  );

  it('deleting package-lock.json re-resolves from the registry and installs (pins may move)', async () => {
    const { fs, vfs, requests } = await applied('compact');
    fs.rmSync('/project/package-lock.json', { force: true });
    const result = await installToolchainPackages({ cwd: '/project', registryUrl }, vfs);
    expect(result.packages).toBeGreaterThan(0);
    expect(requests).toContain(`${registryUrl}/esbuild-wasm`);
    expect(requests.some((url) => /\/esbuild-wasm-[^/]+\.tgz$/.test(url))).toBe(true);
  }, 60_000);

  it('replay control: the same lock install succeeds from the restored shadow bytes', async () => {
    const { vfs, requests } = await applied('replay');
    const result = await installToolchainPackages({ cwd: '/project', registryUrl }, vfs);
    expect(result.packages).toBe(12);
    expect(requests.filter((url) => url.includes('esbuild-wasm'))).toEqual([]);
  }, 60_000);
});
