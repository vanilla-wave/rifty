import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { TARBALL_CACHE_ROOT } from '@riftydev/npm-client';
import { RegistryClient } from '@riftydev/npm-client';
import type { CommandContext } from '@riftydev/shell';
import { Shell } from '@riftydev/shell';
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestNpmPackageAcquisitionAuthority } from '../glue/npm-shell-command.test-fixture.ts';
import { createNpmShellCommand, parseNpmInstallRequest } from '../glue/npm-shell-command.ts';
import { SyncMirrorVfs } from '../glue/sync-mirror-vfs.ts';
import { runNoCoiProjectCommand } from './no-coi-project-command.ts';
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

async function applied(profile: 'replay' | 'frozen') {
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
          profile: 'frozen',
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

/** Exact text a terminal/SDK reader gets; cause and both exits are carried below (ADR-0547). */
const coldShadowPin = {
  code: 'EBROKENLOCK',
  reason: 'shadow-replay-cache-miss',
  message:
    'EBROKENLOCK: package-lock.json installs esbuild@0.28.0 from its substitute esbuild-wasm@0.28.0 ' +
    '(shadow recipe rifty.shadow-substitution.esbuild.v2), but the tarball cache holds no intact esbuild-wasm@0.28.0. ' +
    'Lockfile replay takes substitute bytes only from the tarball cache and never downloads them. ' +
    'To reinstall this lockfile exactly, restore those bytes to the tarball cache; ' +
    'or delete package-lock.json and run install again to re-resolve through the registry (installed versions may change).',
};

describe('Vite 7.3.6 after a frozen snapshot on a cold cache: no npm reinstall route while the lock is kept (ADR-0547)', () => {
  it.each([
    ['install over the lock', [] as string[], 11],
    ['npm install esbuild (the transitive shadow pin)', ['esbuild'], 11],
    ['npm install ms (an unrelated package)', ['ms@2.0.0'], 12],
  ] as const)(
    '%s fails EBROKENLOCK on esbuild; ordinary tarballs reach the shared cache, project tree unchanged',
    async (_label, specs, ordinary) => {
      const { fs, vfs, requests } = await applied('frozen');
      const before = digestTree(snapshotExactFsTree(fs), '/project/');
      await expect(
        installToolchainPackages(
          { cwd: '/project', registryUrl },
          vfs,
          ...(specs.length === 0 ? [] : [npm(...specs)]),
        ),
      ).rejects.toMatchObject(coldShadowPin);
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

  it('terminal `npm install` prints the same cause and exits, exit 1 (no-COI project command)', async () => {
    const { fs, vfs, requests } = await applied('frozen');
    let stdout = '';
    let stderr = '';
    const result = await runNoCoiProjectCommand(
      { project: { root: '/project' }, command: 'npm install', cwd: '/project', env: {} },
      new AbortController().signal,
      {
        fs,
        flush: async () => 'memory',
        effects: () => 'unknown',
        onOutput(chunk, stream) {
          if (stream === 'stdout') stdout += chunk;
          else stderr += chunk;
        },
        // The toolchain owner's hook minus its stamp claim (no-coi-toolchain-owner.ts).
        async install(args, context) {
          const parsed = parseNpmInstallRequest(args);
          if (parsed.status !== 'ready') throw new Error(parsed.message);
          await installToolchainPackages({ cwd: context.cwd, registryUrl }, vfs, {
            request: parsed.request,
            context,
          });
          return 0;
        },
      },
    );
    expect({ status: result.status, exitCode: result.exitCode, stderr }).toEqual({
      status: 'exited',
      exitCode: 1,
      stderr: `npm: ${coldShadowPin.message}\n`,
    });
    // Progress lines for the ordinary pins fetched first; no success summary.
    expect(stdout).toMatch(/^npm: installing all from package\.json…\n(?:npm: \+ \S+\n)+$/u);
    expect(requests.filter((url) => url.includes('esbuild'))).toEqual([]);
  }, 60_000);

  it('package-authority terminal maps the cold cache to the installer text, not "lockfile is broken"', async () => {
    const { vfs, requests } = await applied('frozen');
    const deps = {
      vfs,
      registry: new RegistryClient({ baseUrl: registryUrl }),
      runtimeTier: 'no-coi' as const,
    };
    const shell = new Shell({ cwd: '/project' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        ...deps,
        packageAcquisitionAuthority: createTestNpmPackageAcquisitionAuthority(deps),
      }),
    );
    let stderr = '';
    const result = await shell.run('npm install', {
      onChunk: (chunk, stream) => {
        if (stream === 'stderr') stderr += chunk;
      },
    });
    expect({ exitCode: result.exitCode, stderr }).toEqual({
      exitCode: 1,
      stderr: `npm: ${coldShadowPin.message}\n`,
    });
    expect(requests.filter((url) => url.includes('esbuild'))).toEqual([]);
  }, 60_000);

  it('deleting package-lock.json re-resolves from the registry and installs (pins may move)', async () => {
    const { fs, vfs, requests } = await applied('frozen');
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
