import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { MemoryFsSync, createMemoryFs, resetSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';
import { buildDepSnapshot, serializeDepSnapshot } from '../glue/dep-snapshot.ts';
import { createInstallStampAuthority } from '../glue/install-stamp-authority.ts';
import { SyncMirrorVfs } from '../glue/sync-mirror-vfs.ts';
import { createPlaygroundProjectCatalog } from '../workbench/internal/playground-project-catalog.ts';
import { definePlaygroundProject } from '../workbench/internal/playground-project-definition.ts';
import type { PlaygroundProjectCatalog, VitePlaygroundPlan } from '../workbench/playground.ts';
import type { ProjectDefinition } from '../workbench/public.ts';
import { createOwnerVfsAuthorityComposition } from './owner-vfs-authority.ts';
import {
  type PackageAcquisitionAuthority,
  createPackageAcquisitionAuthority,
} from './package-acquisition-authority.ts';
import { createPlaygroundProjectAuthority } from './playground-project-authority.ts';
import { DurableOwnerFs } from './test-fixtures/durable-owner-fs.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const CAPTURED_URL_CONTEXT = Object.freeze({
  apiBaseUrl: 'https://playground.invalid/app/',
  clientUrl: 'https://playground.invalid/app/index.html',
});
const EDITED_AT = '2026-07-16T12:00:00.000Z';
const SCRATCH_ROOT = '/.rifty/workbench/v1/projects/scratch/tree';

type SnapshotApplication = {
  readonly mode: 'apply';
  readonly conflict?: 'error' | 'overwrite';
};

function snapshotFixture(lockfile: string, marker: string): {
  readonly gzip: Uint8Array;
  readonly snapshotId: string;
} {
  const { fsSync } = createMemoryFs();
  const root = '/bake';
  fsSync.mkdirSync(`${root}/node_modules/pin`, { recursive: true });
  fsSync.writeFileSync(
    `${root}/package.json`,
    encoder.encode('{"name":"app","dependencies":{"pin":"1.0.0"}}\n'),
  );
  fsSync.writeFileSync(`${root}/package-lock.json`, encoder.encode(lockfile));
  fsSync.writeFileSync(
    `${root}/node_modules/pin/package.json`,
    encoder.encode('{"name":"pin","version":"1.0.0"}\n'),
  );
  fsSync.writeFileSync(`${root}/node_modules/pin/readme.txt`, encoder.encode(marker));
  const bytes = encoder.encode(
    serializeDepSnapshot(
      buildDepSnapshot(fsSync, root, {
        templateId: 'vite-template-v1',
        deps: { pin: '1.0.0' },
        packages: 1,
      }),
    ),
  );
  return {
    gzip: gzipSync(bytes),
    snapshotId: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
}

function definition(snapshotId: string, assetUrl: string): ProjectDefinition<unknown> {
  const plan: VitePlaygroundPlan = {
    kind: 'vite',
    id: 'scratch',
    starterId: 'starter-a',
    templateId: 'vite-template-v1',
    files: {
      '/index.html': '<main>fault</main>\n',
      '/package.json': '{"name":"app","scripts":{"dev":"vite"},"devDependencies":{"vite":"8.0.0"}}\n',
      '/src/main.ts': 'document.body.dataset.ready = "yes";\n',
    },
    devDependencies: { vite: '8.0.0' },
    port: 5173,
    firstMaterialization: {
      kind: 'snapshot',
      snapshot: { snapshotId, assetUrl, templateId: 'vite-template-v1' },
    },
  };
  return definePlaygroundProject(plan, CAPTURED_URL_CONTEXT);
}

async function harness(fs: MemoryFsSync | DurableOwnerFs) {
  const composition = createOwnerVfsAuthorityComposition(fs, {
    ownerEpoch: 'snapshot-application-fault-owner',
    initialRoots: ['/', '/.rifty'],
  });
  const vfs = new SyncMirrorVfs();
  const stamps = createInstallStampAuthority({
    vfs,
    fsSync: composition.authority,
    claimIo: composition.installStampClaims,
  });
  const packages = createPackageAcquisitionAuthority({
    stamps,
    stampTransition: { flush: () => composition.authority.flush() },
    adapter: {
      readTrustedPackageLock: async () => ({ lockfileVersion: 3, packages: {} }),
      planSnapshotRestore: async () => ({ status: 'rejected' as const, reason: 'not requested' }),
      install: async () => {
        throw new Error('fault harness must not install');
      },
      reset: async () => {},
      switchProject: async () => {},
    },
  }) as Pick<PackageAcquisitionAuthority, 'projectSave'>;
  let stages = 0;
  const owner = await createPlaygroundProjectAuthority({
    ...composition,
    persistence: 'required',
    now: () => EDITED_AT,
    createStageId: () => `snapshot-application-fault-${String(++stages)}`,
    acquisition: Object.freeze({
      ensure: async () => Object.freeze({ kind: 'install' as const, snapshotFailures: [] }),
    }),
    projectSave: packages,
  });
  return {
    authority: composition.authority,
    owner,
    catalog: createPlaygroundProjectCatalog(owner),
  };
}

afterEach(() => {
  resetSyncMirror();
});

describe('snapshot application fault (I8)', () => {
  it('reopen after apply-error keeps the only preserved copy', async () => {
    const first = snapshotFixture('{"lockfileVersion":3,"packages":{}}\n', 'pin-a\n');
    const next = snapshotFixture('{"lockfileVersion":3,"packages":{"x":{}}}\n', 'pin-b\n');
    const durable = new DurableOwnerFs();
    const h = await harness(durable);
    const initial = definition(first.snapshotId, '/snapshots/a.json.gz');
    await h.catalog.createScratch({ definition: initial });
    const opened = await h.owner.openProject(initial);
    h.authority.writeFileSync(`${opened.projectRoot}/user.txt`, encoder.encode('only copy'));
    h.authority.writeFileSync(`${opened.projectRoot}/package-lock.json`, encoder.encode('saved-lock\n'));
    await h.owner.recordMutation({
      kind: 'guest',
      project: opened,
      treeRevision: h.owner.treeRevision(),
    });
    await opened.close();
    await h.authority.flush();

    try {
      await h.catalog.createScratch({
        definition: definition(next.snapshotId, '/snapshots/b.json.gz'),
        ...({ snapshotApplication: { mode: 'apply', conflict: 'error' } } satisfies {
          snapshotApplication: SnapshotApplication;
        }),
      } as Parameters<PlaygroundProjectCatalog['createScratch']>[0]);
    } catch {
      // apply-error must keep bytes; reseed today may not throw
    }
    await h.authority.flush();
    await h.owner.close();

    const restarted = await harness(durable.restartFromDurableState());
    expect(
      decoder.decode(restarted.authority.readFileBytesSync(`${SCRATCH_ROOT}/user.txt`)),
    ).toBe('only copy');
    expect(
      decoder.decode(restarted.authority.readFileBytesSync(`${SCRATCH_ROOT}/package-lock.json`)),
    ).toBe('saved-lock\n');
    await restarted.owner.close();
  });
});
