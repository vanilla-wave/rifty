import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createMemoryFs } from '@riftydev/vfs/internal';
import { afterEach, expect, it, vi } from 'vitest';
import { projectDependencySnapshotTier } from '../glue/dep-snapshot-runtime-tier.ts';
import { parseDepSnapshot, serializeDepSnapshot } from '../glue/dep-snapshot.ts';
import { applyNoCoiSnapshot } from './no-coi-snapshot-application.ts';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('applies a COI-identity snapshot with one replay-cache verification and the no-COI projection', async () => {
  // The baked `vite` starter is no-COI; its COI projection rewrites the lock and
  // esbuild facade, so applying it must project back exactly once.
  const noCoi = parseDepSnapshot(
    gunzipSync(
      readFileSync(
        new URL(
          '../../../../apps/playground/public/snapshots/vite-node-modules.json.gz',
          import.meta.url,
        ),
      ),
    ).toString('utf8'),
  );
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
