import { readFile } from 'node:fs/promises';
import { VfsTarballCache } from '@riftydev/npm-client';
import { resetSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readInstallStampSync, stampTrusted } from '../glue/install-stamp.ts';
import { openSnapshotOnlyOwner, snapshotOnlyNetwork } from './test-fixtures/snapshot-only-owner.ts';
import {
  type SavedSnapshotFixture,
  bakeSavedSnapshotFixture,
  savedSnapshotDefinition,
} from './test-fixtures/snapshot-saved-state.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
let fixture: SavedSnapshotFixture;
let tarball: Uint8Array;
beforeAll(async () => {
  fixture = await bakeSavedSnapshotFixture();
  tarball = new Uint8Array(
    await readFile(
      new URL('../../../../tests/integration/fixtures/registry/ms-2.0.0.tgz', import.meta.url),
    ),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetSyncMirror();
});

async function seededOwner() {
  const network = snapshotOnlyNetwork();
  network.routes.set(fixture.descriptor.assetUrl, () => new Response(fixture.archive.slice()));
  const h = await openSnapshotOnlyOwner(network);
  const definition = savedSnapshotDefinition('scratch', fixture.descriptor);
  await h.catalog.createScratch({ definition });
  const opened = await h.owner.openProject(definition);
  expect(opened.acquisition).toMatchObject({ kind: 'ready', provenance: { outcome: 'snapshot' } });
  network.requests.length = 0;
  return { h, network, opened, root: opened.projectRoot };
}

describe('I3 explicit npm command retains local behavior without acquisition capability', () => {
  it('replays actual locked cached tarball bytes after the installed package is removed', async () => {
    const { h, network, opened, root } = await seededOwner();
    try {
      const original = h.authority.readFileBytesSync(`${root}/node_modules/ms/index.js`).slice();
      const lock = JSON.parse(fixture.payload.lockfile) as {
        readonly packages: Readonly<Record<string, { readonly integrity?: string }>>;
      };
      const integrity = lock.packages['node_modules/ms']?.integrity;
      expect(integrity).toBeTypeOf('string');
      if (integrity === undefined)
        throw new Error('real producer lock must carry upstream integrity');
      const cache = new VfsTarballCache(h.vfs);
      await cache.put('ms', '2.0.0', integrity, tarball);
      expect(await cache.get('ms', '2.0.0', integrity)).toEqual(tarball);
      await h.packages.mutations.guardedMutation(
        [{ kind: 'rm', path: `${root}/node_modules/ms` }],
        async () => {
          h.authority.rmSync(`${root}/node_modules/ms`, { recursive: true });
        },
      );
      expect(h.authority.statSyncOrNull(`${root}/node_modules/ms`)).toBeNull();
      const result = await h.createShell(root).run('npm install');
      expect(result.exitCode, result.stderr).toBe(0);
      await h.packages.quiesce();
      expect(h.authority.readFileBytesSync(`${root}/node_modules/ms/index.js`)).toEqual(original);
      const stamp = readInstallStampSync(h.authority, root);
      expect(stamp !== null && stampTrusted(stamp)).toBe(true);
      expect(network.requests).toEqual([]);
    } finally {
      await opened.close();
      await h.close();
    }
  });

  it.each([
    'npm install unavailable-required@1.0.0',
    'npm install unavailable-required@1.0.0 --prefer-online',
  ])(
    '%s fails loudly for a required local miss without registry or Eddy effects',
    async (command) => {
      const { h, network, opened, root } = await seededOwner();
      try {
        const result = await h.createShell(root).run(command);
        expect.soft(result.exitCode).not.toBe(0);
        expect
          .soft(result.stderr)
          .toMatch(
            /not implemented.*(?:registry|acquisition)|(?:registry|acquisition).*unavailable/i,
          );
        expect.soft(result.stderr).not.toMatch(/Cannot read properties|undefined is not/);
        expect.soft(network.requests).toEqual([]);
      } finally {
        await opened.close();
        await h.close();
      }
    },
  );

  it('npm run nested prefix install reaches the same unavailable capability boundary', async () => {
    const { h, network, opened, root } = await seededOwner();
    try {
      const manifestPath = `${root}/package.json`;
      const manifest = JSON.parse(
        decoder.decode(h.authority.readFileBytesSync(manifestPath)),
      ) as Record<string, unknown>;
      await h.packages.mutations.guardedMutation(
        [{ kind: 'write', path: manifestPath }],
        async () => {
          h.authority.writeFileSync(
            manifestPath,
            encoder.encode(
              JSON.stringify({
                ...manifest,
                scripts: {
                  nested: 'npm --prefix child install unavailable-required@1.0.0 --prefer-online',
                },
              }),
            ),
          );
        },
      );
      h.authority.mkdirSync(`${root}/child`, { recursive: true });
      h.authority.writeFileSync(
        `${root}/child/package.json`,
        encoder.encode('{"name":"nested-child","version":"1.0.0"}'),
      );
      h.authority.writeFileSync(`${root}/user.txt`, encoder.encode('ordinary saved bytes'));
      const parentManifest = h.authority.readFileBytesSync(manifestPath).slice();
      const result = await h.createShell(root).run('npm run nested');
      expect.soft(result.exitCode).not.toBe(0);
      expect
        .soft(result.stderr)
        .toMatch(
          /not implemented.*(?:registry|acquisition)|(?:registry|acquisition).*unavailable/i,
        );
      expect.soft(result.stderr).not.toMatch(/Cannot read properties|undefined is not/);
      expect
        .soft(
          h.authority.readFileBytesSync(manifestPath),
          'prefix selects the child without rewriting parent request',
        )
        .toEqual(parentManifest);
      expect
        .soft(h.authority.readFileBytesSync(`${root}/user.txt`))
        .toEqual(encoder.encode('ordinary saved bytes'));
      expect.soft(network.requests).toEqual([]);
    } finally {
      await opened.close();
      await h.close();
    }
  });
});
