import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createMemoryFs } from '@riftydev/vfs/internal';
import { afterEach, expect, it, vi } from 'vitest';
import { applyNoCoiSnapshot } from './no-coi-snapshot-application.ts';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('applies a real baked snapshot with one replay-cache verification', async () => {
  const gzipped = readFileSync(
    new URL(
      '../../../../apps/playground/public/snapshots/vite8-node-modules.json.gz',
      import.meta.url,
    ),
  );
  const bytes = gunzipSync(gzipped);
  const baked = JSON.parse(bytes.toString('utf8')) as {
    readonly templateId: string;
    readonly tarballCache: { readonly files: readonly { readonly content: string }[] };
  };
  const replayLengths = new Set(
    baked.tarballCache.files.map((file) => Buffer.from(file.content, 'base64').byteLength),
  );
  expect(baked.tarballCache.files.length).toBeGreaterThan(0);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(gzipped)),
  );
  const digest = vi.spyOn(globalThis.crypto.subtle, 'digest');
  const { fsSync } = createMemoryFs();
  fsSync.mkdirSync('/project', { recursive: true });

  await applyNoCoiSnapshot(
    {
      cwd: '/project',
      snapshot: {
        snapshotId: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
        assetUrl: 'https://sdk.test/snapshots/vite8.json.gz',
        templateId: baked.templateId,
      },
    },
    { fs: fsSync, flush: async () => undefined },
  );

  expect(fsSync.existsSync('/project/node_modules/vite/package.json')).toBe(true);
  const replayVerifications = digest.mock.calls.filter(
    ([algorithm, data]) =>
      algorithm === 'SHA-512' && replayLengths.has((data as ArrayBufferView).byteLength),
  );
  expect(replayVerifications).toHaveLength(baked.tarballCache.files.length);
}, 60_000);
