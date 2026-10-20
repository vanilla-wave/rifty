import { Buffer as NativeBuffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { RegistryClient, extractTarGz, install } from '@riftydev/npm-client';
import { planShadowSubstitutionsFromLockfile } from '@riftydev/npm-client/internal';
import { createMemoryFs } from '@riftydev/vfs/internal';
import { expect, it, vi } from 'vitest';
import { finalizePackageInstallFiles } from '../workers/package-install-finalizer.ts';
import { prepareDepSnapshotApplication } from './dep-snapshot-application.ts';
import { type DepSnapshotV3, buildDepSnapshot, parseDepSnapshot } from './dep-snapshot.ts';
import { createInstallStampAuthority } from './install-stamp-authority.ts';

function legacySnapshot(): DepSnapshotV3 {
  return parseDepSnapshot(
    gunzipSync(
      readFileSync(
        new URL(
          '../../../../apps/playground/public/snapshots/vite-node-modules.json.gz',
          import.meta.url,
        ),
      ),
    ).toString('utf8'),
  );
}

async function apply(snapshot: DepSnapshotV3, runtimeTier: 'coi' | 'no-coi') {
  const memory = createMemoryFs();
  memory.fsSync.mkdirSync('/target', { recursive: true });
  const options = { conflict: 'overwrite' as const, runtimeTier, flush: async () => undefined };
  const plan = await prepareDepSnapshotApplication(memory.fsSync, '/target', snapshot, options);
  await plan.prepareCache();
  await plan.apply();
  const lock = JSON.parse(
    new TextDecoder().decode(memory.fsSync.readFileBytesSync('/target/package-lock.json')),
  );
  return { ...memory, plan, lock };
}

it.fails(
  'selects a COI facade from the real Vite snapshot without network or transitive changes',
  async () => {
    const snapshot = legacySnapshot();
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    try {
      const result = await apply(snapshot, 'coi');
      for (const file of snapshot.nodeModules.files) {
        if (file.path.startsWith('esbuild/')) continue;
        expect(
          NativeBuffer.compare(
            result.fsSync.readFileBytesSync(`/target/node_modules/${file.path}`),
            NativeBuffer.from(file.content, 'base64'),
          ),
          file.path,
        ).toBe(0);
      }
      expect(result.lock.packages['node_modules/esbuild'].riftyShadowRecipe).toBe(
        'rifty.shadow-substitution.esbuild.wasm-node.v1',
      );
      expect(planShadowSubstitutionsFromLockfile(result.lock).bindings).toEqual([]);
      const prior = JSON.parse(snapshot.lockfile).packages;
      for (const [path, entry] of Object.entries(prior)) {
        if (path !== 'node_modules/esbuild')
          expect(result.lock.packages[path], path).toEqual(entry);
      }
      expect(network).not.toHaveBeenCalled();
    } finally {
      network.mockRestore();
    }
  },
  30_000,
);

it('preserves the exact no-COI snapshot files and receipt', async () => {
  const snapshot = legacySnapshot();
  const result = await apply(snapshot, 'no-coi');
  for (const file of snapshot.nodeModules.files) {
    expect(
      NativeBuffer.compare(
        result.fsSync.readFileBytesSync(`/target/node_modules/${file.path}`),
        NativeBuffer.from(file.content, 'base64'),
      ),
      file.path,
    ).toBe(0);
  }
  expect(result.lock).toEqual(JSON.parse(snapshot.lockfile));
  expect(result.plan.shadowPlan.bindings).toHaveLength(1);
}, 30_000);

it.each(['corrupt', 'missing', 'trace'])(
  'rejects %s replay evidence before touching the destination',
  async (fault) => {
    const snapshot = legacySnapshot();
    const lock = JSON.parse(snapshot.lockfile);
    if (fault === 'trace')
      lock.rifty.shadowSubstitutions.applied[0].catalog.digest = '0'.repeat(64);
    const corrupted = {
      ...snapshot,
      lockfile: JSON.stringify(lock),
      tarballCache: {
        ...snapshot.tarballCache,
        files:
          fault === 'missing'
            ? []
            : fault === 'corrupt'
              ? snapshot.tarballCache.files.map((file) => ({ ...file, content: btoa('corrupt') }))
              : snapshot.tarballCache.files,
      },
    };
    const { fsSync } = createMemoryFs();
    fsSync.mkdirSync('/target', { recursive: true });
    fsSync.writeFileSync('/target/keep', new TextEncoder().encode('keep'));
    const options = {
      conflict: 'overwrite' as const,
      runtimeTier: 'coi' as const,
      flush: async () => undefined,
    };
    await expect(
      prepareDepSnapshotApplication(fsSync, '/target', corrupted, options),
    ).rejects.toThrow();
    expect(fsSync.readdirSync('/target').map((entry) => entry.name)).toEqual(['keep']);
    expect(new TextDecoder().decode(fsSync.readFileBytesSync('/target/keep'))).toBe('keep');
  },
  30_000,
);

it.fails(
  'refuses a COI 0.28.2 snapshot by no-COI tier before destination mutation',
  async () => {
    const bytes = readFileSync(
      new URL(
        '../../../../tests/integration/fixtures/registry/esbuild-upstream/esbuild-wasm-0.28.2.tgz',
        import.meta.url,
      ),
    );
    const files = await extractTarGz(bytes);
    const manifest = JSON.parse(new TextDecoder().decode(files['package.json']));
    const registry = new RegistryClient({
      baseUrl: 'https://snapshot-fixture.test',
      fetch: async (input) =>
        String(input).endsWith('.tgz')
          ? new Response(new Uint8Array(bytes))
          : Response.json({
              name: 'esbuild-wasm',
              versions: {
                '0.28.2': {
                  ...manifest,
                  dist: {
                    tarball: 'https://snapshot-fixture.test/esbuild-wasm.tgz',
                    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
                  },
                },
              },
              'dist-tags': { latest: '0.28.2' },
            }),
    });
    const source = createMemoryFs();
    source.fsSync.mkdirSync('/source', { recursive: true });
    const packageJson = JSON.stringify({ name: 'snapshot', dependencies: { esbuild: '^0.28.0' } });
    source.fsSync.writeFileSync('/source/package.json', new TextEncoder().encode(packageJson));
    const installed = await install({
      vfs: source.vfs,
      cwd: '/source',
      registry,
      runtimeTier: 'coi',
    });
    await finalizePackageInstallFiles({ root: '/source', fs: source.fsSync });
    const snapshot = buildDepSnapshot(source.fsSync, '/source', {
      templateId: 'tier',
      deps: { esbuild: '^0.28.0' },
      packages: installed.packages.length,
    });
    const target = createMemoryFs();
    target.fsSync.mkdirSync('/target', { recursive: true });
    target.fsSync.writeFileSync('/target/keep', new TextEncoder().encode('keep'));
    const options = {
      conflict: 'overwrite' as const,
      runtimeTier: 'no-coi' as const,
      flush: async () => undefined,
    };
    const error = await prepareDepSnapshotApplication(
      target.fsSync,
      '/target',
      snapshot,
      options,
    ).then(
      () => null,
      (error) => String(error),
    );
    expect(error).toContain('no-coi');
    expect(target.fsSync.readdirSync('/target').map((entry) => entry.name)).toEqual(['keep']);
  },
  30_000,
);

it.fails('install claims distinguish the selected runtime policy', async () => {
  const stamps = [];
  for (const runtimeTier of ['coi', 'no-coi'] as const) {
    const memory = createMemoryFs();
    const packageJsonText = '{"name":"stamp","private":true}';
    memory.fsSync.mkdirSync('/project/node_modules', { recursive: true });
    memory.fsSync.writeFileSync('/project/package.json', new TextEncoder().encode(packageJsonText));
    const options = { ...memory, runtimeTier };
    const authority = createInstallStampAuthority(options);
    const claim = await authority.demote({ root: '/project', slug: 'stamp' });
    const result = await authority.promote(
      { root: '/project', slug: 'stamp', packageJsonText },
      { epoch: claim.epoch, packages: 0 },
    );
    if (result.status !== 'trusted') throw Error(`unexpected ${result.status}`);
    stamps.push(result.stamp.installArtifactIdentity);
  }
  expect(stamps[0]).not.toBe(stamps[1]);
});
