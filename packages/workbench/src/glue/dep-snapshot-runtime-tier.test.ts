import { Buffer as NativeBuffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { RegistryClient, extractTarGz, install } from '@riftydev/npm-client';
import { planShadowSubstitutionsFromLockfile } from '@riftydev/npm-client/internal';
import { createMemoryFs } from '@riftydev/vfs/internal';
import { expect, it, vi } from 'vitest';
import { finalizePackageInstallFiles } from '../workers/package-install-finalizer.ts';
import { prepareDepSnapshotApplication } from './dep-snapshot-application.ts';
import {
  type DepSnapshot,
  buildDepSnapshot,
  parseDepSnapshot,
  prepareDepSnapshotRestore,
} from './dep-snapshot.ts';
import { createInstallStampAuthority } from './install-stamp-authority.ts';

function legacySnapshot(): DepSnapshot {
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

async function apply(snapshot: DepSnapshot, runtimeTier: 'coi' | 'no-coi') {
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

function assertNativeFacade(fsSync: ReturnType<typeof createMemoryFs>['fsSync']): void {
  const nativeRoot = mkdtempSync(join(tmpdir(), 'rifty-tier-snapshot-'));
  try {
    const copy = (source: string, target: string): void => {
      for (const entry of fsSync.readdirSync(source)) {
        const from = `${source}/${entry.name}`;
        const to = join(target, entry.name);
        if (entry.isDirectory) copy(from, to);
        else {
          mkdirSync(dirname(to), { recursive: true });
          writeFileSync(to, fsSync.readFileBytesSync(from));
        }
      }
    };
    copy('/target/node_modules', join(nativeRoot, 'node_modules'));
    const run = (name: string) =>
      execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `import esbuild,{transform,version} from '${name}';const result=await transform('let x:number=1',{loader:'ts'});console.log(JSON.stringify({version,same:transform===esbuild.transform,code:result.code}));esbuild.stop();`,
        ],
        { cwd: nativeRoot, encoding: 'utf8', timeout: 30_000 },
      );
    const oracle = run('esbuild-wasm');
    expect(run('esbuild')).toBe(oracle);
  } finally {
    rmSync(nativeRoot, { recursive: true, force: true });
  }
}

it('selects a COI facade from the real Vite snapshot without network or transitive changes', async () => {
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
    assertNativeFacade(result.fsSync);
    expect(result.lock.packages['node_modules/esbuild'].riftyShadowRecipe).toBe(
      'rifty.shadow-substitution.esbuild.wasm-node.v1',
    );
    expect(planShadowSubstitutionsFromLockfile(result.lock).bindings).toEqual([]);
    const prior = JSON.parse(snapshot.lockfile).packages;
    for (const [path, entry] of Object.entries(prior)) {
      if (path !== 'node_modules/esbuild') expect(result.lock.packages[path], path).toEqual(entry);
    }
    expect(network).not.toHaveBeenCalled();
  } finally {
    network.mockRestore();
  }
}, 30_000);

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

it.each(['corrupt', 'missing', 'trace', 'identity'])(
  'rejects %s replay evidence before touching the destination',
  async (fault) => {
    const snapshot = legacySnapshot();
    const lock = JSON.parse(snapshot.lockfile);
    if (fault === 'trace')
      lock.rifty.shadowSubstitutions.applied[0].catalog.digest = '0'.repeat(64);
    const corrupted = {
      ...snapshot,
      ...(fault === 'identity' ? { installArtifactIdentity: `sha256:${'0'.repeat(64)}` } : {}),
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

it('refuses a COI 0.28.2 snapshot by no-COI tier before destination mutation', async () => {
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
    (error: { name?: string; feature?: string; message?: string }) => ({
      name: error.name,
      feature: error.feature,
      message: error.message,
    }),
  );
  expect(error).toMatchObject({ name: 'NotImplementedError', feature: 'esbuild.version' });
  expect(error?.message).toMatch(/no-coi/i);
  expect(target.fsSync.readdirSync('/target').map((entry) => entry.name)).toEqual(['keep']);
}, 30_000);

it('install claims distinguish the selected runtime policy', async () => {
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
    const input = { root: '/project', slug: 'stamp', expectedPackageJsonText: packageJsonText };
    expect((await authority.check(input)).status).toBe('trusted');
    expect(authority.checkSync(input).status).toBe('trusted');
    expect((await createInstallStampAuthority(options).check(input)).status).toBe('trusted');
    const otherOptions = {
      ...memory,
      runtimeTier: runtimeTier === 'coi' ? ('no-coi' as const) : ('coi' as const),
    };
    expect((await createInstallStampAuthority(otherOptions).check(input)).status).not.toBe(
      'trusted',
    );
  }
  expect(stamps[0]).not.toBe(stamps[1]);
});

it('plain restore uses the same selected-tier materialization', async () => {
  const snapshot = legacySnapshot();
  const { fsSync } = createMemoryFs();
  fsSync.mkdirSync('/target', { recursive: true });
  fsSync.writeFileSync('/target/package.json', new TextEncoder().encode(snapshot.packageJsonText));
  const prepared = await prepareDepSnapshotRestore(fsSync, '/target', snapshot, {
    runtimeTier: 'coi',
  });
  prepared.apply();
  assertNativeFacade(fsSync);
}, 30_000);

it('selects a policy for an empty snapshot without inventing a lock', async () => {
  const source = createMemoryFs();
  source.fsSync.mkdirSync('/source/node_modules', { recursive: true });
  source.fsSync.writeFileSync('/source/package.json', new TextEncoder().encode('{}'));
  const snapshot = buildDepSnapshot(source.fsSync, '/source', {
    templateId: 'empty',
    deps: {},
    packages: 0,
  });
  const target = createMemoryFs();
  target.fsSync.mkdirSync('/target', { recursive: true });
  const options = {
    conflict: 'overwrite' as const,
    runtimeTier: 'coi' as const,
    flush: async () => undefined,
  };
  const plan = await prepareDepSnapshotApplication(target.fsSync, '/target', snapshot, options);
  await plan.prepareCache();
  await plan.apply();
  expect(plan.shadowPlan.substitutions).toEqual([]);
  expect(
    new TextDecoder().decode(target.fsSync.readFileBytesSync('/target/package-lock.json')),
  ).toBe('');
});
