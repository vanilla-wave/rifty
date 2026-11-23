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

type Network = Awaited<ReturnType<typeof registry>>;

/** The committed Vite snapshot as replay (its replay cache) or frozen (same payload, none). */
async function applySnapshot(
  fs: MemoryFsSync,
  network: Network,
  profile: 'replay' | 'frozen',
  force = false,
) {
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
  const url = `${assetUrl}?${profile}`;
  network.assets.set(url, bytes);
  if (!fs.existsSync('/project/package.json')) {
    fs.mkdirSync('/project', { recursive: true });
    fs.writeFileSync('/project/package.json', new TextEncoder().encode(baked.packageJsonText));
  }
  await applyNoCoiSnapshot(
    {
      cwd: '/project',
      snapshot: {
        assetUrl: url,
        snapshotId: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
        templateId: 'vite',
      },
      ...(force ? { force } : {}),
    },
    { fs, flush: async () => undefined },
  );
}

async function applied(profile: 'replay' | 'frozen') {
  const network = await registry();
  const fs = new MemoryFsSync();
  await applySnapshot(fs, network, profile);
  const vfs = new SyncMirrorVfs();
  setSyncMirror(fs, { async: vfs });
  network.requests.length = 0;
  return { fs, vfs, network, requests: network.requests };
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

/** Exact text every reader gets (terminals prefix `npm: `); its one exit is executed below each reader's way (ADR-0547). */
const refusal = {
  code: 'EBROKENLOCK',
  reason: 'shadow-replay-cache-miss',
  message:
    'EBROKENLOCK: package-lock.json installs esbuild@0.28.0 from its substitute esbuild-wasm@0.28.0 ' +
    '(shadow recipe rifty.shadow-substitution.esbuild.v2), but the tarball cache holds no intact copy of it. ' +
    'Lockfile replay takes substitutes only from that cache and never downloads them, so this lockfile cannot be reinstalled exactly here. ' +
    'To install anyway, delete package-lock.json and run install again: it re-resolves through the registry, and installed versions may change.',
};

/** The toolchain owner's terminal hook minus its stamp claim (no-coi-toolchain-owner.ts). */
async function noCoiTerminal(fs: MemoryFsSync, vfs: SyncMirrorVfs, command: string) {
  let stdout = '';
  let stderr = '';
  const result = await runNoCoiProjectCommand(
    { project: { root: '/project' }, command, cwd: '/project', env: {} },
    new AbortController().signal,
    {
      fs,
      flush: async () => 'memory',
      effects: () => 'unknown',
      onOutput(chunk, stream) {
        if (stream === 'stdout') stdout += chunk;
        else stderr += chunk;
      },
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
  return { status: result.status, exitCode: result.exitCode, stdout, stderr };
}

/** Package-authority terminal (`reportInstallError`) over the same installer. */
async function authorityTerminal(vfs: SyncMirrorVfs, command: string) {
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
  const result = await shell.run(command, {
    onChunk: (chunk, stream) => {
      if (stream === 'stderr') stderr += chunk;
    },
  });
  return { exitCode: result.exitCode, stderr };
}

const lockless = (requests: readonly string[]) => ({
  packument: requests.includes(`${registryUrl}/esbuild-wasm`),
  tarball: requests.some((url) => /\/esbuild-wasm-[^/]+\.tgz$/.test(url)),
});

describe('Vite 7.3.6 after a frozen snapshot on a cold cache: no npm reinstall route while the lock is kept (ADR-0547)', () => {
  it.each([
    ['toolchain.install over the lock', [] as string[], 11],
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
      ).rejects.toMatchObject(refusal);
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

  it('no-COI terminal: `npm install` prints the terminal text; `rm package-lock.json && npm install` then re-resolves', async () => {
    const { fs, vfs, requests } = await applied('frozen');
    const refused = await noCoiTerminal(fs, vfs, 'npm install');
    expect({ ...refused, stdout: undefined }).toEqual({
      status: 'exited',
      exitCode: 1,
      stdout: undefined,
      stderr: `npm: ${refusal.message}\n`,
    });
    // Progress lines for the ordinary pins fetched first; no success summary.
    expect(refused.stdout).toMatch(
      /^npm: installing all from package\.json…\n(?:npm: \+ \S+\n)+$/u,
    );
    expect(requests.filter((url) => url.includes('esbuild'))).toEqual([]);
    const exit = await noCoiTerminal(fs, vfs, 'rm package-lock.json && npm install');
    expect({ status: exit.status, exitCode: exit.exitCode, stderr: exit.stderr }).toEqual({
      status: 'exited',
      exitCode: 0,
      stderr: '',
    });
    expect(lockless(requests)).toEqual({ packument: true, tarball: true });
    expect(fs.existsSync('/project/node_modules/esbuild/package.json')).toBe(true);
  }, 60_000);

  it('package-authority terminal: same text (not "lockfile is broken"); the same lockfile exit works', async () => {
    const { fs, vfs, requests } = await applied('frozen');
    expect(await authorityTerminal(vfs, 'npm install')).toEqual({
      exitCode: 1,
      stderr: `npm: ${refusal.message}\n`,
    });
    expect(requests.filter((url) => url.includes('esbuild'))).toEqual([]);
    expect(await authorityTerminal(vfs, 'rm package-lock.json && npm install')).toEqual({
      exitCode: 0,
      stderr: '',
    });
    expect(lockless(requests)).toEqual({ packument: true, tarball: true });
    expect(fs.existsSync('/project/node_modules/esbuild/package.json')).toBe(true);
  }, 60_000);

  it('SDK exit: deleting package-lock.json then toolchain.install re-resolves (pins may move)', async () => {
    const { fs, vfs, requests } = await applied('frozen');
    fs.rmSync('/project/package-lock.json', { force: true });
    const result = await installToolchainPackages({ cwd: '/project', registryUrl }, vfs);
    expect(result.packages).toBeGreaterThan(0);
    expect(lockless(requests)).toEqual({ packument: true, tarball: true });
  }, 60_000);

  it('ADR-0547 §Consequences: the replay-profile snapshot restores the exact install only on an unchanged project', async () => {
    const { fs, vfs, network, requests } = await applied('frozen');
    await expect(
      installToolchainPackages({ cwd: '/project', registryUrl }, vfs),
    ).rejects.toMatchObject(refusal);
    const lock = fs.readFileBytesSync('/project/package-lock.json');
    const manifest = fs.readFileBytesSync('/project/package.json');
    // A host edit to package.json conflicts by default; force reverts the edit.
    const edited = JSON.parse(new TextDecoder().decode(manifest)) as {
      dependencies?: Record<string, string>;
    };
    edited.dependencies = { ...edited.dependencies, ms: '2.0.0' };
    fs.writeFileSync('/project/package.json', new TextEncoder().encode(JSON.stringify(edited)));
    await expect(applySnapshot(fs, network, 'replay')).rejects.toThrow(/conflict/i);
    await applySnapshot(fs, network, 'replay', true);
    expect(fs.readFileBytesSync('/project/package.json'), 'force reverted the edit').toEqual(
      manifest,
    );
    // A lock changed only in whitespace conflicts too.
    const relocked = await applied('frozen');
    relocked.fs.writeFileSync(
      '/project/package-lock.json',
      new TextEncoder().encode(`${new TextDecoder().decode(lock)}\n`),
    );
    await expect(applySnapshot(relocked.fs, relocked.network, 'replay')).rejects.toThrow(
      /conflict/i,
    );
    // Unchanged since the frozen snapshot: applies without force, install is exact.
    const fresh = await applied('frozen');
    await applySnapshot(fresh.fs, fresh.network, 'replay');
    fresh.requests.length = 0;
    const result = await installToolchainPackages({ cwd: '/project', registryUrl }, fresh.vfs);
    expect(result.packages).toBe(12);
    expect(fresh.requests.filter((url) => url.includes('esbuild'))).toEqual([]);
    expect(fresh.fs.readFileBytesSync('/project/package-lock.json')).toEqual(lock);
    expect(requests.filter((url) => url.includes('esbuild'))).toEqual([]);
  }, 60_000);

  it('replay control: the same lock install succeeds from the restored shadow bytes', async () => {
    const { vfs, requests } = await applied('replay');
    const result = await installToolchainPackages({ cwd: '/project', registryUrl }, vfs);
    expect(result.packages).toBe(12);
    expect(requests.filter((url) => url.includes('esbuild-wasm'))).toEqual([]);
  }, 60_000);
});
