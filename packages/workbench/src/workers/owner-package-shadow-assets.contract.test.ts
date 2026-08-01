import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { type InstallOptions, type Packument, RegistryClient, install } from '@riftydev/npm-client';
import {
  type PackageTreeShadowAssetBoundary,
  SHADOW_ASSET_PORT_CAPABILITY,
  type ShadowAssetPlan,
  type ShadowAssetReadySet,
  createMemoryShadowAssetStorage,
  createOriginExclusiveShadowAssetManager,
  createShadowAssetPortClient,
  shadowAssetPlanForInstallResult,
} from '@riftydev/npm-client/internal';
import { createMemoryFs, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, expect, it } from 'vitest';
import { SyncMirrorVfs } from '../glue/sync-mirror-vfs.ts';
import { type OwnerPackageConfig, createOwnerPackageState } from './owner-package-state.ts';
import { createOwnerVfsAuthorityComposition } from './owner-vfs-authority.ts';

const requireFromRegistry = createRequire(
  new URL('../../../../tools/shadow-registry/package.json', import.meta.url),
);
const assetBytes = new Uint8Array(
  await readFile(requireFromRegistry.resolve('esbuild-wasm/esbuild.wasm')),
);
const assetSha256 = createHash('sha256').update(assetBytes).digest('hex');
const ROOTS = ['/projects/first', '/projects/second'] as const;

class RejectingRegistry extends RegistryClient {
  constructor() {
    super({ baseUrl: '/must-not-read', fetch: async () => new Response('', { status: 599 }) });
  }

  override async getPackument(name: string): Promise<Packument> {
    throw new Error(`synthetic esbuild must not read registry metadata for ${name}`);
  }

  override async getTarball(url: string): Promise<Uint8Array> {
    throw new Error(`synthetic esbuild must not read registry tarball ${url}`);
  }
}

function packageConfig(root: string, name: string): OwnerPackageConfig {
  const packageJson = `${JSON.stringify({
    name,
    version: '1.0.0',
    dependencies: { esbuild: '^0.28.0' },
  })}\n`;
  return {
    cfg: {
      runtime: 'vite',
      root,
      port: 5173,
      entryPath: `${root}/src/main.ts`,
      packageName: name,
      packageVersion: '1.0.0',
      installDeps: { esbuild: '^0.28.0' },
      packageJson,
      seedFiles: {},
    },
    templateId: 'esbuild-contract',
    slug: name,
    fromScratch: true,
  };
}

afterEach(resetSyncMirror);

it('freezes exact runtime plans and reuses one ready asset across projects', async () => {
  const pair = createMemoryFs();
  const { authority: owner, installStampClaims } = createOwnerVfsAuthorityComposition(pair.fsSync, {
    ownerEpoch: 'owner-shadow-consumer-contract',
    initialRoots: ['/'],
  });
  setSyncMirror(owner, { async: pair.vfs });
  const configs = ROOTS.map((root, index) => packageConfig(root, `app-${String(index + 1)}`));
  for (const config of configs) {
    owner.mkdirSync(config.cfg.root, { recursive: true });
    owner.writeFileSync(
      `${config.cfg.root}/package.json`,
      new TextEncoder().encode(config.cfg.packageJson),
    );
  }

  const baseStorage = createMemoryShadowAssetStorage();
  let objectWrites = 0;
  const storage: Parameters<typeof createOriginExclusiveShadowAssetManager>[0]['storage'] = {
    storageClass: baseStorage.storageClass,
    read: (entry) => baseStorage.read(entry),
    write: async (entry, bytes) => {
      if (entry.kind === 'object') {
        objectWrites += 1;
      }
      await baseStorage.write(entry, bytes);
    },
    remove: (entry) => baseStorage.remove(entry),
    close: () => baseStorage.close(),
  };
  let acquisitions = 0;
  const manager = createOriginExclusiveShadowAssetManager({
    storage,
    source: {
      acquire: async () => {
        acquisitions += 1;
        return assetBytes.slice();
      },
    },
  });

  const ensuredPlans: ShadowAssetPlan[] = [];
  const readyByPlan = new Map<ShadowAssetPlan, ShadowAssetReadySet>();
  const servedReady: ShadowAssetReadySet[] = [];
  const shadowAssets: PackageTreeShadowAssetBoundary = Object.freeze({
    async ensure(plan: ShadowAssetPlan) {
      ensuredPlans.push(plan);
      expect(Object.isFrozen(plan)).toBe(true);
      expect(Object.isFrozen(plan.substitutions)).toBe(true);
      const ready = await manager.ensure(plan);
      readyByPlan.set(plan, ready);
      return ready;
    },
    serve(ready: ShadowAssetReadySet, port: MessagePort) {
      servedReady.push(ready);
      return manager.serve(ready, port);
    },
  });

  const plansByRoot = new Map<string, ShadowAssetPlan>();
  const state = createOwnerPackageState({
    primeInitialPrefetch: false,
    vfs: new SyncMirrorVfs(),
    fsSync: owner,
    installStampClaims,
    flush: async () => ({ failures: [], total: 0 }),
    nodeWorkerRuntimeEnv: {},
    log: () => {},
    registry: new RejectingRegistry(),
    shadowAssets,
    install: async (arg1) => {
      if (typeof arg1 === 'string') throw new Error('owner install must use InstallOptions');
      const options: InstallOptions = arg1;
      const result = await install(options);
      plansByRoot.set(options.cwd, shadowAssetPlanForInstallResult(result));
      return result;
    },
    resolverUrl: () => undefined,
    resolverBundleBaseUrl: () => undefined,
    resolverPin: () => undefined,
  });

  for (const config of configs) await state.activateAndEnsure(config);

  expect(acquisitions).toBe(1);
  expect(objectWrites).toBe(1);
  expect(ensuredPlans).toHaveLength(2);

  for (const root of ROOTS) {
    const exactPlan = plansByRoot.get(root);
    if (!exactPlan) throw new Error(`installer plan missing for ${root}`);
    expect(ensuredPlans.some((plan) => plan === exactPlan)).toBe(true);
    const exactReady = readyByPlan.get(exactPlan);
    if (!exactReady) throw new Error(`manager ready set missing for ${root}`);

    const reservation = await state.reserveChildAdmission(root);
    expect(reservation.snapshot.ready).toBe(exactReady);
    expect(servedReady.at(-1)).toBe(exactReady);
    const port = reservation.snapshot.capabilityPorts[SHADOW_ASSET_PORT_CAPABILITY];
    if (!(port instanceof MessagePort)) throw new Error(`shadow capability missing for ${root}`);
    if (root === ROOTS[0]) {
      const client = createShadowAssetPortClient(port, { deadlineMs: 1_000 });
      await client.ready;
      const servedBytes = await client.read(exactPlan.assets[0]!.id);
      expect(createHash('sha256').update(servedBytes).digest('hex')).toBe(assetSha256);
      client.dispose();
    }
    reservation.snapshot.dispose();
    reservation.commit();
  }

  await manager.close();
});
