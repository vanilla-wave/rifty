import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { TARBALL_CACHE_ROOT } from '@riftydev/npm-client';
import { createMemoryFs } from '@riftydev/vfs/internal';
import { afterEach, expect, it, vi } from 'vitest';
import { projectDependencySnapshotTier } from '../glue/dep-snapshot-runtime-tier.ts';
import { parseDepSnapshot, serializeDepSnapshot } from '../glue/dep-snapshot.ts';
import { applyNoCoiSnapshot } from './no-coi-snapshot-application.ts';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function bakedVite() {
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

function serveSnapshot(bytes: Uint8Array) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(bytes.slice())),
  );
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

it('applies a COI-identity snapshot with one replay-cache verification and the no-COI projection', async () => {
  // The baked `vite` starter is no-COI; its COI projection rewrites the lock and
  // esbuild facade, so applying it must project back exactly once.
  const noCoi = bakedVite();
  const coi = projectDependencySnapshotTier(noCoi, 'coi');
  expect(coi.lockfile).not.toBe(noCoi.lockfile);
  expect(coi.tarballCache.files.length).toBeGreaterThan(0);
  const bytes = new TextEncoder().encode(serializeDepSnapshot(coi));
  const replayLengths = new Set(
    coi.tarballCache.files.map((file) => Buffer.from(file.content, 'base64').byteLength),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(bytes)),
  );
  const digest = vi.spyOn(globalThis.crypto.subtle, 'digest');
  const { fsSync } = createMemoryFs();
  fsSync.mkdirSync('/project', { recursive: true });

  await applyNoCoiSnapshot(
    {
      cwd: '/project',
      snapshot: {
        snapshotId: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
        assetUrl: 'https://sdk.test/snapshots/vite.json',
        templateId: coi.templateId,
      },
    },
    { fs: fsSync, flush: async () => undefined },
  );

  expect(fsSync.existsSync('/project/node_modules/vite/package.json')).toBe(true);
  const restoredLockfile = new TextDecoder().decode(
    fsSync.readFileBytesSync('/project/package-lock.json'),
  );
  expect(JSON.parse(restoredLockfile)).toEqual(JSON.parse(noCoi.lockfile));
  const replayVerifications = digest.mock.calls.filter(
    ([algorithm, data]) =>
      algorithm === 'SHA-512' && replayLengths.has((data as ArrayBufferView).byteLength),
  );
  expect(replayVerifications).toHaveLength(coi.tarballCache.files.length);
}, 60_000);

it('[fault: poisoned-cache] rejects a corrupt replay cache before any cache or project write', async () => {
  const baked = bakedVite();
  expect(baked.tarballCache.files.length).toBeGreaterThan(0);
  const corrupt = {
    ...baked,
    tarballCache: {
      ...baked.tarballCache,
      files: baked.tarballCache.files.map((file) => ({
        ...file,
        content: Buffer.from('corrupt replay bytes').toString('base64'),
      })),
    },
  };
  const bytes = new TextEncoder().encode(serializeDepSnapshot(corrupt));
  const snapshotId = serveSnapshot(bytes);
  const { fsSync } = createMemoryFs();
  fsSync.mkdirSync('/project', { recursive: true });
  const flush = vi.fn(async () => undefined);

  await expect(
    applyNoCoiSnapshot(
      {
        cwd: '/project',
        snapshot: {
          snapshotId,
          assetUrl: 'https://sdk.test/snapshots/corrupt.json',
          templateId: baked.templateId,
        },
      },
      { fs: fsSync, flush },
    ),
  ).rejects.toThrow(/^Dep snapshot replay cache integrity mismatch for /);

  expect(fsSync.existsSync(TARBALL_CACHE_ROOT)).toBe(false);
  expect(fsSync.readdirSync('/project')).toEqual([]);
  expect(flush).not.toHaveBeenCalled();
}, 60_000);
