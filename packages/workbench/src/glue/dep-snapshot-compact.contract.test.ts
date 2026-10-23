import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { TARBALL_CACHE_ROOT } from '@riftydev/npm-client';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyNoCoiSnapshot } from '../workers/no-coi-snapshot-application.ts';
import { snapshotExactFsTree } from '../workers/test-fixtures/durable-owner-fs.ts';
import { bakeSavedSnapshotFixture } from '../workers/test-fixtures/snapshot-saved-state.ts';
import { decodeDepSnapshotTar } from './dep-snapshot-tar.ts';
import {
  parseDepSnapshot,
  serializeDepSnapshot,
  serializeDepSnapshotTar,
  sha256Identity,
  verifyDepSnapshotReplayCache,
} from './dep-snapshot.ts';

const compact = (value: object) => ({
  ...value,
  version: 5,
  profile: 'compact',
  tarballCache: { version: 1, root: TARBALL_CACHE_ROOT, files: [] },
});
afterEach(() => vi.unstubAllGlobals());

describe('compact snapshot admission (I1–I3)', () => {
  it.fails(
    'roundtrips explicit compact JSON and tar without replay; retains the complete prepared payload',
    async () => {
      const { payload } = await bakeSavedSnapshotFixture();
      const source = parseDepSnapshot(JSON.stringify(compact(payload)));
      expect(JSON.parse(serializeDepSnapshot(source))).toEqual(compact(payload));
      const decoded = parseDepSnapshot(
        JSON.stringify(decodeDepSnapshotTar(serializeDepSnapshotTar(source))),
      );
      expect(decoded.nodeModules.files).toEqual(source.nodeModules.files);
      expect(decoded).toMatchObject({
        version: 5,
        profile: 'compact',
        tarballCache: { files: [] },
      });
    },
  );
  it.fails('admits a compact shadow tree without its ordinary exact replay closure', async () => {
    const legacy = JSON.parse(
      gunzipSync(
        await readFile('apps/playground/public/snapshots/vite-node-modules.json.gz'),
      ).toString(),
    );
    expect(legacy.tarballCache.files.length).toBeGreaterThan(0);
    await expect(
      verifyDepSnapshotReplayCache(parseDepSnapshot(JSON.stringify(compact(legacy)))),
    ).resolves.toBeUndefined();
    await expect(
      verifyDepSnapshotReplayCache({ ...legacy, tarballCache: compact(legacy).tarballCache }),
    ).rejects.toThrow(/closure|missing/i);
  });
  it.fails(
    'applies compact through the no-COI owner without any shared-cache mutation',
    async () => {
      const { payload, descriptor } = await bakeSavedSnapshotFixture();
      const bytes = new TextEncoder().encode(JSON.stringify(compact(payload)));
      vi.stubGlobal('fetch', async () => new Response(bytes));
      const fs = new MemoryFsSync();
      fs.mkdirSync('/project', { recursive: true });
      fs.mkdirSync(TARBALL_CACHE_ROOT, { recursive: true });
      fs.writeFileSync(`${TARBALL_CACHE_ROOT}/sentinel`, new TextEncoder().encode('warm'));
      const writes = vi.spyOn(fs, 'writeFileSync');
      const mkdirs = vi.spyOn(fs, 'mkdirSync');
      const flush = vi.fn(async () => undefined);
      await applyNoCoiSnapshot(
        { cwd: '/project', snapshot: { ...descriptor, snapshotId: await sha256Identity(bytes) } },
        { fs, flush },
      );
      expect(
        new TextDecoder().decode(fs.readFileBytesSync('/project/node_modules/ms/package.json')),
      ).toContain('2.0.0');
      expect(writes.mock.calls.filter(([path]) => path.startsWith(TARBALL_CACHE_ROOT))).toEqual([]);
      expect(mkdirs.mock.calls.filter(([path]) => path.startsWith(TARBALL_CACHE_ROOT))).toEqual([]);
      expect(new TextDecoder().decode(fs.readFileBytesSync(`${TARBALL_CACHE_ROOT}/sentinel`))).toBe(
        'warm',
      );
      expect(flush).toHaveBeenCalledTimes(1);
    },
  );
  for (const fault of [
    'unknown-profile',
    'legacy-profile',
    'replay-smuggling',
    'malformed-lock',
    'incompatible',
    'unsafe-path',
  ]) {
    (fault === 'legacy-profile' ? it.fails : it)(
      `rejects ${fault} before application (I3)`,
      async () => {
        const { payload, descriptor } = await bakeSavedSnapshotFixture();
        const value = compact(payload);
        if (fault === 'unknown-profile') value.profile = 'mystery';
        if (fault === 'legacy-profile') value.version = 3;
        if (fault === 'replay-smuggling')
          Object.assign(value.tarballCache, {
            files: [{ path: 'extra', encoding: 'base64', content: btoa('extra') }],
          });
        if (fault === 'malformed-lock') Object.assign(value, { lockfile: '{broken' });
        if (fault === 'incompatible')
          Object.assign(value, { installArtifactIdentity: `sha256:${'0'.repeat(64)}` });
        if (fault === 'unsafe-path')
          Object.assign(value, {
            nodeModules: {
              ...payload.nodeModules,
              files: [{ path: '../outside', encoding: 'base64', content: btoa('bad') }],
            },
          });
        const bytes = new TextEncoder().encode(JSON.stringify(value));
        vi.stubGlobal('fetch', async () => new Response(bytes));
        const fs = new MemoryFsSync();
        fs.mkdirSync('/project', { recursive: true });
        fs.writeFileSync('/project/keep', new TextEncoder().encode('saved'));
        const before = snapshotExactFsTree(fs);
        const flush = vi.fn(async () => undefined);
        await expect(
          applyNoCoiSnapshot(
            {
              cwd: '/project',
              snapshot: { ...descriptor, snapshotId: await sha256Identity(bytes) },
            },
            { fs, flush },
          ),
        ).rejects.toThrow();
        expect(snapshotExactFsTree(fs)).toEqual(before);
        expect(flush).not.toHaveBeenCalled();
      },
    );
  }
});
