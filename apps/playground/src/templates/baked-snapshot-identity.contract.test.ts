import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { allProjectSpecs } from './registry.ts';

const PUBLIC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../public');
const GENERATED_IDENTITIES = join(
  dirname(fileURLToPath(import.meta.url)),
  '../generated/baked-snapshot-identities.json',
);

interface BakedSnapshotIdentityManifest {
  readonly version: 1;
  readonly snapshots: Readonly<Record<string, string>>;
}

const PROVEN_VITE8_WASI_RUNTIME_OVERRIDE = {
  '@napi-rs/wasm-runtime': 'npm:@napi-rs/wasm-runtime@1.1.6',
} as const;

function artifactPath(url: string): string {
  return join(PUBLIC_ROOT, ...url.replace(/^\/+/, '').split('/'));
}

function serializedSnapshotIdentity(url: string): string {
  const serialized = gunzipSync(readFileSync(artifactPath(url)));
  return `sha256:${createHash('sha256').update(serialized).digest('hex')}`;
}

function readGeneratedManifest(): BakedSnapshotIdentityManifest {
  return JSON.parse(readFileSync(GENERATED_IDENTITIES, 'utf8')) as BakedSnapshotIdentityManifest;
}

describe('baked snapshot identity contract', () => {
  it('bakes exact Vite 8 from the visible proven WASI runtime override', () => {
    const spec = allProjectSpecs().find((candidate) => candidate.id === 'vite8');
    if (spec?.bakedNodeModulesUrl === undefined) {
      throw new Error('vite8 baked snapshot descriptor missing');
    }
    const snapshot = JSON.parse(
      gunzipSync(readFileSync(artifactPath(spec.bakedNodeModulesUrl))).toString('utf8'),
    ) as { readonly packageJsonText?: unknown };
    if (typeof snapshot.packageJsonText !== 'string') {
      throw new Error('vite8 snapshot package.json missing');
    }

    expect(JSON.parse(snapshot.packageJsonText)).toMatchObject({
      dependencies: { vite: '8.0.16' },
      overrides: PROVEN_VITE8_WASI_RUNTIME_OVERRIDE,
    });
  });

  it.each(allProjectSpecs().map((spec) => [spec.id, spec] as const))(
    'keeps %s URL and bake-owned identity paired',
    (_id, spec) => {
      if (spec.bakedNodeModulesUrl === undefined) {
        expect(spec.bakedNodeModulesSnapshotId).toBeUndefined();
        return;
      }

      expect(spec.bakedNodeModulesSnapshotId).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(spec.bakedNodeModulesSnapshotId).toBe(
        serializedSnapshotIdentity(spec.bakedNodeModulesUrl),
      );
    },
  );

  it('keeps the generated manifest exact, complete, and artifact-derived', () => {
    const baked = allProjectSpecs().filter((spec) => spec.bakedNodeModulesUrl !== undefined);
    const manifest = readGeneratedManifest();

    expect(Reflect.ownKeys(manifest)).toEqual(['version', 'snapshots']);
    expect(manifest.version).toBe(1);
    expect(Object.keys(manifest.snapshots)).toEqual(baked.map((spec) => spec.id).sort());
    for (const spec of baked) {
      if (spec.bakedNodeModulesUrl === undefined) throw new Error('filtered snapshot URL missing');
      const artifactIdentity = serializedSnapshotIdentity(spec.bakedNodeModulesUrl);
      expect(manifest.snapshots[spec.id]).toBe(artifactIdentity);
      expect(spec.bakedNodeModulesSnapshotId).toBe(artifactIdentity);
    }
  });

  it('uses the bake helper to derive stable identities from serialized bytes and deterministic keys', async () => {
    const {
      buildBakedSnapshotIdentityManifest,
      emitBakedSnapshotOutputs,
      serializeBakedSnapshotIdentityManifest,
      snapshotIdentityFromSerializedBytes,
    } = await import('../../tools/baked-snapshot-identities.ts');
    const serialized = new TextEncoder().encode('{"version":2,"files":[]}');
    const recompressedFast = gzipSync(serialized, { level: 1 });
    const recompressedSmall = gzipSync(serialized, { level: 9 });
    expect(recompressedFast).not.toEqual(recompressedSmall);

    const firstIdentity = snapshotIdentityFromSerializedBytes(gunzipSync(recompressedFast));
    const secondIdentity = snapshotIdentityFromSerializedBytes(gunzipSync(recompressedSmall));
    const changedIdentity = snapshotIdentityFromSerializedBytes(
      new TextEncoder().encode('{"version":2,"files":[ ]}'),
    );
    expect(firstIdentity).toBe(secondIdentity);
    expect(changedIdentity).not.toBe(firstIdentity);

    const manifest = buildBakedSnapshotIdentityManifest([
      { id: 'z-template', serializedBytes: serialized },
      { id: 'a-template', serializedBytes: serialized },
    ]);
    expect(manifest).toEqual({
      version: 1,
      snapshots: { 'a-template': firstIdentity, 'z-template': firstIdentity },
    });
    expect(serializeBakedSnapshotIdentityManifest(manifest)).toBe(
      `${JSON.stringify(manifest, null, 2)}\n`,
    );

    const emitted: string[] = [];
    const emittedArtifacts = new Map<string, Uint8Array>();
    let emittedManifest = '';
    await emitBakedSnapshotOutputs(
      [
        {
          id: 'z-template',
          assetUrl: '/snapshots/z.json.gz',
          serializedBytes: serialized,
          compressedBytes: recompressedSmall,
        },
        {
          id: 'a-template',
          assetUrl: '/snapshots/a.json.gz',
          serializedBytes: serialized,
          compressedBytes: recompressedFast,
        },
      ],
      {
        async writeArtifact(assetUrl: string, bytes: Uint8Array) {
          emitted.push(`artifact:${assetUrl}:${String(bytes.byteLength)}`);
          emittedArtifacts.set(assetUrl, bytes.slice());
        },
        async writeIdentityManifest(contents: string) {
          emitted.push('manifest');
          emittedManifest = contents;
        },
      },
    );
    expect(emitted).toEqual([
      `artifact:/snapshots/z.json.gz:${String(recompressedSmall.byteLength)}`,
      `artifact:/snapshots/a.json.gz:${String(recompressedFast.byteLength)}`,
      'manifest',
    ]);
    expect(emittedArtifacts.get('/snapshots/z.json.gz')).toEqual(recompressedSmall);
    expect(emittedArtifacts.get('/snapshots/a.json.gz')).toEqual(recompressedFast);
    expect(emittedManifest).toBe(serializeBakedSnapshotIdentityManifest(manifest));
  });
});
