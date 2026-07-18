import {
  type ShadowAssetPlan,
  type ShadowAssetSource,
  type ShadowAssetSourceRequest,
  type ShadowAssetSourceResult,
  createShadowAssetManager,
} from '@riftydev/npm-client';
import { createWorkbenchOwnerStorageComposition } from '../workers/workbench-owner-storage-composition.ts';

const encoder = new TextEncoder();
const ASSET_MARKER = 'BROWSER_UNIT_PRIVATE_RUNTIME_ASSET';
const TARBALL_MARKER = 'BROWSER_UNIT_RETAINED_TARBALL';
const TARBALL_PATH = '/.rifty/tarball-cache/browser-unit-runtime-asset-storage.tgz';
const RETAINED_PROJECT_ROOT = '/.rifty/workbench/v1/projects/browser-runtime-assets-retained/tree';

interface FixtureCommand {
  readonly type: 'seed' | 'inspect-after-clear';
}

interface FixtureReply {
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: Readonly<{ name: string; message: string }>;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError('Browser runtime-asset fixture accepts plain canonical values only');
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

async function digestHex(algorithm: 'SHA-256' | 'SHA-512', bytes: Uint8Array): Promise<string> {
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest(algorithm, owned));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Canonical(value: unknown): Promise<string> {
  return digestHex('SHA-256', encoder.encode(canonicalJson(value)));
}

async function sriSha512(bytes: Uint8Array): Promise<string> {
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-512', owned));
  let binary = '';
  for (const byte of digest) binary += String.fromCharCode(byte);
  return `sha512-${btoa(binary)}`;
}

function tar(name: string, bytes: Uint8Array): Uint8Array {
  const header = new Uint8Array(512);
  header.set(encoder.encode(name), 0);
  header.set(encoder.encode(bytes.byteLength.toString(8).padStart(11, '0')), 124);
  header[135] = 0;
  header[156] = '0'.charCodeAt(0);
  const padding = new Uint8Array((512 - (bytes.byteLength % 512)) % 512);
  const archive = new Uint8Array(header.byteLength + bytes.byteLength + padding.byteLength + 1024);
  archive.set(header, 0);
  archive.set(bytes, header.byteLength);
  archive.set(padding, header.byteLength + bytes.byteLength);
  return archive;
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const compressed = new Blob([bytes as unknown as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(compressed).arrayBuffer());
}

async function fixturePlan(): Promise<{
  readonly plan: ShadowAssetPlan;
  readonly member: Uint8Array;
  readonly tarball: Uint8Array;
}> {
  const member = encoder.encode(ASSET_MARKER);
  const unpacked = tar('package/runtime.bin', member);
  const tarball = await gzip(unpacked);
  const substitutions: ShadowAssetPlan['substitutions'] = [
    {
      catalog: { id: 'browser-unit.runtime-assets', digest: 'a'.repeat(64) },
      publicName: 'browser-runtime',
      requestedRange: '1.0.0',
      resolvedPublicVersion: '1.0.0',
      substitutionId: 'browser-unit.runtime-assets.substitution',
      runtimeAdapterId: 'browser-unit.runtime-assets.adapter',
      builtin: true,
    },
  ];
  const assets: ShadowAssetPlan['assets'] = [
    {
      id: 'browser-runtime.bin',
      source: {
        name: 'browser-runtime-source',
        version: '1.0.0',
        integrity: await sriSha512(tarball),
      },
      member: 'package/runtime.bin',
      memberSha256: await digestHex('SHA-256', member),
      memberSize: member.byteLength,
      maxTarballBytes: tarball.byteLength,
      maxUnpackedBytes: unpacked.byteLength,
    },
  ];
  const plan: ShadowAssetPlan = {
    requiredSetDigest: await sha256Canonical({ schema: 1, substitutions, assets }),
    substitutions,
    assets,
  };
  return { plan, member, tarball };
}

async function ownerComposition() {
  const composition = await createWorkbenchOwnerStorageComposition('required');
  if (composition.storage.backend !== 'opfs') {
    throw new Error('Browser fixture required durable OPFS');
  }
  return composition;
}

async function assertCleanFlush(
  authority: Awaited<ReturnType<typeof ownerComposition>>['owner']['authority'],
): Promise<void> {
  const report = await authority.flush();
  if (report !== undefined && report.total > 0) {
    throw new Error(`Browser fixture flush failed with ${String(report.total)} failure(s)`);
  }
}

async function seed(): Promise<unknown> {
  const composition = await ownerComposition();
  const authority = composition.owner.authority;
  const storage = composition.runtimeAssets;
  const fixture = await fixturePlan();
  const source: ShadowAssetSource = Object.freeze({
    async acquire(
      requests: readonly ShadowAssetSourceRequest[],
    ): Promise<readonly ShadowAssetSourceResult[]> {
      return requests.map((request) => {
        if (
          request.name !== fixture.plan.assets[0]?.source.name ||
          request.version !== fixture.plan.assets[0]?.source.version ||
          request.integrity !== fixture.plan.assets[0]?.source.integrity
        ) {
          throw new Error('Browser fixture source received unexpected request');
        }
        return Object.freeze({
          request,
          bytes: fixture.tarball.slice(),
          fillTransport: 'standard' as const,
          fillCache: 'network' as const,
        });
      });
    },
    async close() {},
  });
  const manager = createShadowAssetManager({ storage, source });
  try {
    await manager.admin.clearCache();
    const ready = await manager.installer.ensure(fixture.plan);
    if (ready.kind !== 'ready') throw new Error('Browser fixture manager did not publish ready');
    authority.mkdirSync(TARBALL_PATH.slice(0, TARBALL_PATH.lastIndexOf('/')), {
      recursive: true,
    });
    authority.writeFileSync(TARBALL_PATH, encoder.encode(TARBALL_MARKER));
    await assertCleanFlush(authority);
    return {
      assetMarker: ASSET_MARKER,
      memberSha256: fixture.plan.assets[0]?.memberSha256,
      requiredSetDigest: fixture.plan.requiredSetDigest,
      tarballMarker: TARBALL_MARKER,
      usage: await manager.admin.inspectUsage(),
    };
  } finally {
    await manager.close();
    await assertCleanFlush(authority);
  }
}

async function inspectAfterClear(): Promise<unknown> {
  const composition = await ownerComposition();
  const authority = composition.owner.authority;
  const storage = composition.runtimeAssets;
  const fixture = await fixturePlan();
  const source: ShadowAssetSource = Object.freeze({
    async acquire(): Promise<readonly ShadowAssetSourceResult[]> {
      throw new Error('Post-clear runtime lookup must not start acquisition');
    },
    async close() {},
  });
  const manager = createShadowAssetManager({ storage, source });
  try {
    const tarball = authority.statSyncOrNull(TARBALL_PATH)?.isFile
      ? new TextDecoder().decode(authority.readFileBytesSync(TARBALL_PATH))
      : null;
    let lookup: Readonly<{ name: string; phase: unknown; recovery: unknown }> | null = null;
    try {
      await manager.runtimeReader(fixture.plan).readVerified('browser-runtime.bin');
    } catch (error) {
      const failure = error as Error & { readonly phase?: unknown; readonly recovery?: unknown };
      lookup = Object.freeze({
        name: error instanceof Error ? error.name : 'Error',
        phase: failure.phase,
        recovery: failure.recovery,
      });
    }
    if (lookup === null) throw new Error('Post-clear runtime asset lookup unexpectedly succeeded');
    return {
      runtimeAssets: await storage.inspect(),
      managerUsage: await manager.admin.inspectUsage(),
      lookup,
      tarball,
      retainedProject: authority.statSyncOrNull(RETAINED_PROJECT_ROOT)?.isDirectory,
    };
  } finally {
    await manager.close();
    await assertCleanFlush(authority);
  }
}

const scope = globalThis as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = (event: MessageEvent<FixtureCommand>) => {
  const operation =
    event.data.type === 'seed'
      ? seed()
      : event.data.type === 'inspect-after-clear'
        ? inspectAfterClear()
        : Promise.reject(new TypeError('Unknown browser runtime-asset fixture command'));
  void operation.then(
    (result) => scope.postMessage({ ok: true, result } satisfies FixtureReply),
    (error: unknown) =>
      scope.postMessage({
        ok: false,
        error: {
          name: error instanceof Error ? error.name : 'Error',
          message: error instanceof Error ? error.message : String(error),
        },
      } satisfies FixtureReply),
  );
};
