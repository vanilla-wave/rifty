import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  RegistryClient,
  type ShadowAssetSource,
  VfsTarballCache,
  createMemoryShadowAssetStorage,
  createShadowAssetManager,
  createStandardShadowAssetSource,
  getRegistryBaseUrl,
  planBuiltinShadowAssets,
} from '../../packages/npm-client/src/index.ts';
import { MemoryVfs } from '../../packages/vfs/src/index.ts';
import { builtinShadowAssetCatalog } from '../shadow-registry/src/index.ts';

const execFile = promisify(execFileCallback);
const EXPECTED_VERSION = '0.28.0';
const EXPECTED_MEMBER_SIZE = 13_918_738;
const EXPECTED_MEMBER_SHA256 = '9d99d51a13469befdcfca172855f62724b87bdfc0c87a6a0729ddbb455d0fa3b';
const CONFIG_TIMEOUT_MS = 30_000;

class ObservedRegistryClient extends RegistryClient {
  packumentReads = 0;
  tarballReads = 0;

  override async getPackument(name: string) {
    this.packumentReads += 1;
    return super.getPackument(name);
  }

  override async getTarball(url: string, maxBytes?: number): Promise<Uint8Array> {
    this.tarballReads += 1;
    return super.getTarball(url, maxBytes);
  }
}

async function configuredRegistryBaseUrl(): Promise<string> {
  const repoConfigured = getRegistryBaseUrl();
  if (!repoConfigured.startsWith('/')) return repoConfigured;
  const { stdout } = await execFile('npm', ['config', 'get', 'registry'], {
    killSignal: 'SIGKILL',
    maxBuffer: 1024 * 1024,
    timeout: CONFIG_TIMEOUT_MS,
  });
  const configured = stdout.trim();
  const parsed = new URL(configured);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('npm registry configuration must be an HTTP(S) origin');
  }
  return configured;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Mandatory live proof: catalog -> STD source -> manager -> verified Memory store hit. */
export async function verifyRealShadowAssetAcceptance(): Promise<void> {
  const substitution = builtinShadowAssetCatalog.substitutions.find(
    (candidate) => candidate.publicName === 'esbuild',
  );
  assert(substitution, 'builtin catalog omitted esbuild substitution');
  const assetIds = substitution.versions[EXPECTED_VERSION];
  assert(assetIds, `builtin catalog omitted esbuild@${EXPECTED_VERSION}`);
  assert.equal(assetIds.length, 1, 'esbuild substitution must map exactly one runtime asset');
  const asset = builtinShadowAssetCatalog.assets.find((candidate) => candidate.id === assetIds[0]);
  assert(asset, 'builtin catalog omitted its mapped esbuild runtime asset');
  assert.equal(asset.source.version, EXPECTED_VERSION);
  assert.equal(asset.memberSize, EXPECTED_MEMBER_SIZE);
  assert.equal(asset.memberSha256, EXPECTED_MEMBER_SHA256);

  const plan = planBuiltinShadowAssets([
    {
      catalog: {
        id: builtinShadowAssetCatalog.id,
        digest: builtinShadowAssetCatalog.digest,
      },
      publicName: substitution.publicName,
      requestedRange: EXPECTED_VERSION,
      resolvedPublicVersion: EXPECTED_VERSION,
      substitutionId: substitution.id,
      runtimeAdapterId: substitution.runtimeAdapterId,
      builtin: true,
    },
  ]);
  assert.equal(plan.assets.length, 1);
  assert.equal(plan.assets[0]?.id, asset.id);

  const registry = new ObservedRegistryClient({ baseUrl: await configuredRegistryBaseUrl() });
  const standard = createStandardShadowAssetSource({
    registry,
    tarballCache: new VfsTarballCache(new MemoryVfs()),
  });
  let sourceReads = 0;
  const source: ShadowAssetSource = Object.freeze({
    acquire: (requests, options) => {
      sourceReads += 1;
      return standard.acquire(requests, options);
    },
    close: () => standard.close(),
  });
  const manager = createShadowAssetManager({
    source,
    storage: createMemoryShadowAssetStorage(),
  });
  try {
    const first = await manager.installer.ensure(plan);
    assert.equal(first.kind, 'ready');
    assert.equal(sourceReads, 1);
    assert.equal(registry.packumentReads, 1);
    assert.equal(registry.tarballReads, 1);
    assert.equal(first.receipt.assets[0]?.fillTransport, 'standard');
    assert.equal(first.receipt.assets[0]?.fillCache, 'network');
    const bytes = await manager.runtimeReader(plan).readVerified(asset.id);
    assert.equal(bytes.byteLength, EXPECTED_MEMBER_SIZE);
    assert.equal(sha256(bytes), EXPECTED_MEMBER_SHA256);

    const sourceReadsAfterFirst = sourceReads;
    const packumentReadsAfterFirst = registry.packumentReads;
    const tarballReadsAfterFirst = registry.tarballReads;
    const second = await manager.installer.ensure(plan);
    assert.equal(second.kind, 'ready');
    assert.equal(second.receipt.receiptSha256, first.receipt.receiptSha256);
    assert.equal(sourceReads, sourceReadsAfterFirst, 'verified second hit must not invoke source');
    assert.equal(
      registry.packumentReads,
      packumentReadsAfterFirst,
      'verified second hit must not read registry metadata',
    );
    assert.equal(
      registry.tarballReads,
      tarballReadsAfterFirst,
      'verified second hit must not download the tarball',
    );
    const secondBytes = await manager.runtimeReader(plan).readVerified(asset.id);
    assert.equal(secondBytes.byteLength, EXPECTED_MEMBER_SIZE);
    assert.equal(sha256(secondBytes), EXPECTED_MEMBER_SHA256);
  } finally {
    await manager.close();
  }
  console.log(
    `shadow asset real acceptance: ${asset.id} ${EXPECTED_MEMBER_SIZE} bytes sha256:${EXPECTED_MEMBER_SHA256}; second hit source=0`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  verifyRealShadowAssetAcceptance().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
